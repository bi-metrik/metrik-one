import 'server-only'
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { cumpleRequisitoModulo, REQUISITO } from '@/lib/modulos/requisito'
import { soportePasaGate } from '@/lib/modulos/gate'
import type { ValidaConsultaInput } from '@/lib/actions/valida-consultas'
import { credencialValida } from './credencial-servidor'
import { motivoCorteDeError, type MotivoCorte, type PruebaValida } from './corte-bolsa'
import { CODIGO_BUSQUEDA_INCOMPLETA, CODIGO_TIPO_DOCUMENTO_NO_ACEPTADO } from './mensajes-error'
import { llamarValida, persistirConsulta, recalcularScoreNegocio, type RespuestaValida } from './consulta-servidor'
import {
  FILA_RECLAMO_S,
  FILAS_PARA_AVISO_CORREO,
  TURNO_MS,
  TURNO_RECLAMO_S,
  TIMEOUT_VALIDA_LOTE_MS,
  claveIdempotenciaFila,
  concurrenciaDelLote,
  filaSeConsulta,
  llamadaReintentable,
  lotesSimultaneos,
  severidadDelConteo,
  textoPausa,
  type MotivoPausa,
} from './lote'

/**
 * El trabajador del cargue masivo de Valida. Corre en el servidor, sin sesión, con `service_role`:
 *
 *   - lo despierta el cron de Vercel cada minuto (`/api/crons/valida-lotes`) y, para que un lote
 *     nuevo no espere ese minuto, `after()` en la acción que lo crea o lo reanuda;
 *   - pide TURNO a la base (`valida_lote_tomar_turno`): a lo sumo `LOTES_SIMULTANEOS` lotes a la vez
 *     en todo ONE, cada turno de `TURNO_MS`, y el siguiente es para el lote que lleva más sin turno.
 *     Un espacio con 10.000 filas no deja esperando a otro con 50;
 *   - dentro del turno, `concurrenciaDelLote` filas a la vez, cada una reclamada de la cola con
 *     `for update skip locked` (`valida_lote_reclamar_fila`);
 *   - la puerta (módulo, contratos, llave) se mira UNA vez por turno, no por fila (ver
 *     `verificarAccesoDelLote`).
 *
 * Sobrevive a que la función se corte: el turno y el reclamo de cada fila vencen solos, y el
 * siguiente trabajador retoma. Una fila nunca se cobra dos veces: la llamada a Valida lleva la
 * `Idempotency-Key` de la fila y el historial tiene la fila como llave única.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any

export type Lote = {
  id: string
  workspace_id: string
  created_by: string | null
  titulo: string | null
  estado: string
  total: number
  procesadas: number
  concurrencia: number | null
  autorizado_hasta: string | null
  huella_acceso: string | null
}

export type FilaLote = {
  id: string
  lote_id: string
  workspace_id: string
  posicion: number
  entrada: ValidaConsultaInput
  negocio_id: string | null
  error_parseo: string | null
  intentos: number
}

/** Lo que una fila deja: hecha (con o sin resultado), corte de la bolsa, rechazo de Valida, o reintentar. */
export type ResultadoFila =
  | { tipo: 'hecha'; negocioParaScore: string | null }
  | { tipo: 'corte'; motivo: MotivoCorte }
  | { tipo: 'rechazo'; error: string }
  | { tipo: 'reintentar'; error: string }

export type ContextoTurno = {
  svc: Svc
  lote: Pick<Lote, 'id' | 'workspace_id' | 'created_by'>
  llave: string
  prueba: PruebaValida | null
  dormir?: (ms: number) => Promise<void>
}

const dormirReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Espera antes del único reintento de una fila que Valida respondió con 5xx. */
const ESPERA_REINTENTO_MS = 2_000

/** Un trabajador sin turno disponible, con lotes activos, vuelve a pedir cada tanto. */
const ESPERA_TURNO_MS = 3_000

/** Lo que se deja libre al final del presupuesto: drenar las filas en vuelo y cerrar el turno. */
const MARGEN_CIERRE_MS = 45_000

/** Intentos de una fila que Valida respondió pero ONE no pudo guardar, antes de darla por error. */
const MAX_INTENTOS_GUARDAR = 3

// ─── Acceso, una vez por turno ───────────────────────────────────────────────────

export type AccesoLote =
  | { ok: true; llave: string; prueba: PruebaValida | null }
  | { ok: false; motivo: MotivoPausa; detalle: string | null }
  /** No se pudo leer: este turno no procesa, pero el lote no se pausa (lo intenta el siguiente). */
  | { ok: false; motivo: null; detalle: string }

/**
 * La puerta del lote, sin sesión. La sesión ya pasó la puerta COMPLETA (`accesoValida` con
 * `consultaNueva`, la misma de la consulta puntual) al crear o reanudar el lote, y cada vez que la
 * pantalla pregunta el progreso; eso deja `autorizado_hasta` (≤ 2 h y nunca más allá del día de
 * Bogotá, ver `autorizadoHasta`). En cada turno, sin sesión, se vuelve a mirar lo que puede cambiar
 * dentro del día:
 *
 *   - el plazo de la autorización;
 *   - el módulo Valida del espacio (el mismo criterio de `exigirModulo`);
 *   - la huella de los contratos de Valida (cancelado, terminado, plazo de términos);
 *   - la llave del espacio.
 *
 * Cualquiera que falle PAUSA el lote. Una lectura caída no pausa, pero tampoco deja procesar.
 */
export async function verificarAccesoDelLote(svc: Svc, lote: Lote, ahora: Date = new Date()): Promise<AccesoLote> {
  if (!lote.autorizado_hasta || Date.parse(lote.autorizado_hasta) <= ahora.getTime()) {
    return { ok: false, motivo: 'reautorizar', detalle: null }
  }

  const [ws, perfil, huella] = await Promise.all([
    svc.from('workspaces').select('modules').eq('id', lote.workspace_id).maybeSingle(),
    lote.created_by
      ? svc.from('profiles').select('platform_admin, workspace_id, home_workspace_id').eq('id', lote.created_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    svc.rpc('valida_lote_huella_acceso', { p_workspace: lote.workspace_id }),
  ])
  if (ws.error || perfil.error || huella.error || !ws.data) {
    return { ok: false, motivo: null, detalle: ws.error?.message ?? perfil.error?.message ?? huella.error?.message ?? 'workspace_sin_fila' }
  }

  const p = perfil.data as { platform_admin?: boolean | null; workspace_id?: string | null; home_workspace_id?: string | null } | null
  const modulo = cumpleRequisitoModulo(REQUISITO.validaConsulta, {
    modules: (ws.data as { modules?: Record<string, boolean> | null }).modules ?? null,
    platformAdmin: soportePasaGate({
      platformAdmin: p?.platform_admin,
      workspaceId: p?.workspace_id,
      homeWorkspaceId: p?.home_workspace_id,
    }),
    modoVitrina: false,
  })
  if (!modulo) return { ok: false, motivo: 'acceso', detalle: 'Este espacio ya no tiene activo el módulo Valida.' }

  if ((huella.data ?? '') !== (lote.huella_acceso ?? '')) return { ok: false, motivo: 'reautorizar', detalle: null }

  let cred: Awaited<ReturnType<typeof credencialValida>>
  try {
    cred = await credencialValida(lote.workspace_id)
  } catch (e) {
    return { ok: false, motivo: null, detalle: (e as Error)?.message ?? 'credencial' }
  }
  if (!cred.llave) return { ok: false, motivo: 'sin_llave', detalle: null }
  return { ok: true, llave: cred.llave, prueba: cred.prueba }
}

// ─── Una fila ────────────────────────────────────────────────────────────────────

type ConsultaGuardada = { id: string; severidad: string; valida_consulta_id: string | null; total_matches: number | null }

async function consultaDeLaFila(svc: Svc, filaId: string): Promise<ConsultaGuardada | null> {
  const { data } = await svc
    .from('valida_consultas')
    .select('id, severidad, valida_consulta_id, total_matches')
    .eq('lote_fila_id', filaId)
    .maybeSingle()
  return (data as ConsultaGuardada | null) ?? null
}

async function terminar(
  svc: Svc,
  fila: FilaLote,
  r: { estado: 'hecha' | 'error'; severidad: string; consulta: string | null; validaId: string | null; matches: number | null; error: string | null },
): Promise<void> {
  const { error } = await svc.rpc('valida_lote_fila_terminar', {
    p_fila: fila.id,
    p_estado: r.estado,
    p_severidad: r.severidad,
    p_severidad_conteo: severidadDelConteo(fila.error_parseo, r.severidad),
    p_consulta_local_id: r.consulta,
    p_valida_consulta_id: r.validaId,
    p_total_matches: r.matches,
    p_error: r.error,
  })
  if (error) throw new Error(`valida_lote_fila_terminar: ${error.message}`)
}

async function terminarConGuardada(svc: Svc, fila: FilaLote, c: ConsultaGuardada): Promise<void> {
  const conResultado = c.severidad !== 'error' && !!c.valida_consulta_id
  await terminar(svc, fila, {
    estado: conResultado ? 'hecha' : 'error',
    severidad: c.severidad,
    consulta: c.id,
    validaId: c.valida_consulta_id,
    matches: c.total_matches,
    error: null,
  })
}

/** La fila vuelve a la cola sin contar: no se consultó (corte o rechazo de Valida), no se cobró. */
async function devolver(svc: Svc, fila: FilaLote): Promise<void> {
  await svc.from('valida_lote_filas').update({ estado: 'pendiente', reclamada_hasta: null }).eq('id', fila.id).eq('estado', 'en_curso')
}

/**
 * Una fila, con el MISMO camino de la consulta puntual (`consultarValida`): el mismo endpoint, el
 * mismo cuerpo, la misma regla de corte de la bolsa y la misma fila en el historial. Lo único que
 * agrega es la idempotencia: la `Idempotency-Key` de la fila y la fila como llave única del historial.
 *
 * Diferencias con la ruta del navegador, todas para no cobrar ni ensuciar:
 *   - un 5xx, un tope de tiempo o un error de red se reintenta UNA vez con la misma llave (Valida no
 *     guardó nada; si lo hizo, repite la respuesta sin cobrar). El tope de la llamada pasa el
 *     `maxDuration` de Valida (`TIMEOUT_VALIDA_LOTE_MS`): el reintento nunca corre a la par de la
 *     primera. Antes un tope de 30 s dejaba la fila en error y la consulta cobrada en Valida;
 *   - un 401/402 que no es corte de la bolsa (llave revocada, paquete vencido sin pago) detiene el
 *     lote: todas las filas siguientes responderían lo mismo. Antes se guardaba una fila en error por
 *     cada una (no se cobraban);
 *   - si Valida respondió y ONE no pudo guardar, la fila se reintenta (la llave hace que Valida
 *     repita la respuesta sin cobrar). Antes se perdía.
 */
export async function procesarFilaLote(ctx: ContextoTurno, fila: FilaLote): Promise<ResultadoFila> {
  const { svc, lote, llave, prueba } = ctx
  const dormir = ctx.dormir ?? dormirReal

  // Reclamada antes por un trabajador que murió: si alcanzó a guardar, no se vuelve a consultar.
  if (fila.intentos > 1) {
    const previa = await consultaDeLaFila(svc, fila.id)
    if (previa) {
      await terminarConGuardada(svc, fila, previa)
      return { tipo: 'hecha', negocioParaScore: null }
    }
  }

  const input = fila.entrada

  // Un tipo de documento que Valida no acepta («X», TI mientras Valida no lo consulte): Valida la
  // rechazaría con 400 sin cobrar. No se llama ni va al historial; la fila queda en error con la frase
  // que puso el parseo, que el XLSX de resultados muestra tal cual.
  if (!filaSeConsulta(input)) {
    await terminar(svc, fila, {
      estado: 'error',
      severidad: 'error',
      consulta: null,
      validaId: null,
      matches: 0,
      error: fila.error_parseo ?? CODIGO_TIPO_DOCUMENTO_NO_ACEPTADO,
    })
    return { tipo: 'hecha', negocioParaScore: null }
  }

  const clave = claveIdempotenciaFila(fila.id)
  const opciones = { claveIdempotencia: clave, timeoutMs: TIMEOUT_VALIDA_LOTE_MS }
  let resultado: RespuestaValida = await llamarValida(llave, input, opciones)
  if (llamadaReintentable(resultado)) {
    await dormir(ESPERA_REINTENTO_MS)
    resultado = await llamarValida(llave, input, opciones)
  }

  if (!resultado.ok) {
    // Corte de la bolsa: Valida no registró ni cobró, y aquí tampoco se guarda (igual que la puntual).
    const corte = motivoCorteDeError(resultado.error, prueba)
    if (corte) {
      await devolver(svc, fila)
      return { tipo: 'corte', motivo: corte }
    }
    if (resultado.status === 401 || resultado.status === 402) {
      await devolver(svc, fila)
      return { tipo: 'rechazo', error: resultado.error }
    }
    // La búsqueda no se completó ni con el reintento: Valida no la registró ni la cobró, así que no
    // va al historial (igual que la consulta puntual). La fila queda en error con el código, que el
    // XLSX de resultados traduce a «No completada, reintenta».
    if (resultado.error === CODIGO_BUSQUEDA_INCOMPLETA) {
      await terminar(svc, fila, {
        estado: 'error',
        severidad: 'error',
        consulta: null,
        validaId: null,
        matches: 0,
        error: CODIGO_BUSQUEDA_INCOMPLETA,
      })
      return { tipo: 'hecha', negocioParaScore: null }
    }
  }

  const persistida = await persistirConsulta({
    workspaceId: lote.workspace_id,
    userId: lote.created_by,
    negocioId: fila.negocio_id,
    loteId: lote.id,
    tipo: 'masiva_item',
    input,
    resultado,
    loteFilaId: fila.id,
  })

  if (!persistida.ok) {
    // Otro trabajador ya la guardó (el reclamo de este venció): se toma la suya.
    if (persistida.code === '23505') {
      const previa = await consultaDeLaFila(svc, fila.id)
      if (previa) {
        await terminarConGuardada(svc, fila, previa)
        return { tipo: 'hecha', negocioParaScore: null }
      }
    }
    if (fila.intentos < MAX_INTENTOS_GUARDAR) return { tipo: 'reintentar', error: persistida.error }
    await terminar(svc, fila, {
      estado: 'error',
      severidad: 'error',
      consulta: null,
      validaId: null,
      matches: null,
      error: `no_guardada: ${persistida.error}`.slice(0, 500),
    })
    return { tipo: 'hecha', negocioParaScore: null }
  }

  await terminar(svc, fila, {
    estado: resultado.ok ? 'hecha' : 'error',
    severidad: resultado.ok ? resultado.data.severidad : 'error',
    consulta: persistida.id,
    validaId: resultado.ok ? resultado.data.consulta_id : null,
    matches: resultado.ok ? resultado.data.total_matches : 0,
    error: resultado.ok ? null : resultado.error.slice(0, 500),
  })
  return { tipo: 'hecha', negocioParaScore: resultado.ok ? fila.negocio_id : null }
}

// ─── Pausa y aviso ───────────────────────────────────────────────────────────────

export async function pausarLote(svc: Svc, loteId: string, motivo: MotivoPausa, detalle: string | null): Promise<boolean> {
  const { data } = await svc
    .from('valida_lotes')
    .update({
      estado: 'pausado',
      motivo_pausa: motivo,
      detalle_pausa: detalle,
      trabajador: null,
      turno_hasta: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', loteId)
    .in('estado', ['en_cola', 'procesando'])
    .select('id')
  return Array.isArray(data) && data.length > 0
}

function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const ETIQUETAS: Record<string, string> = {
  alto: 'alto',
  medio: 'medio',
  bajo: 'bajo',
  informativo: 'informativo',
  sin_hallazgo: 'sin hallazgo',
  error: 'error',
}

/** El texto del correo de fin o de pausa de un lote. Puro, para probarlo. */
export function textoAvisoLote(l: {
  titulo: string | null
  estado: string
  motivo_pausa: string | null
  detalle_pausa: string | null
  total: number
  procesadas: number
  severidades: Record<string, number> | null
}): { asunto: string; texto: string } {
  const nombre = l.titulo ? `«${l.titulo}»` : `de ${l.total} filas`
  const conteo = Object.entries(l.severidades ?? {})
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${ETIQUETAS[s] ?? s}: ${n}`)
    .join(', ')
  if (l.estado === 'completado') {
    return {
      asunto: 'Tu cargue de Valida terminó',
      texto: `Tu cargue ${nombre} terminó: ${l.procesadas} consultas${conteo ? ` (${conteo})` : ''}. El reporte PDF y los resultados están en ONE.`,
    }
  }
  return {
    asunto: 'Tu cargue de Valida se detuvo',
    texto: `Tu cargue ${nombre} se detuvo con ${l.procesadas} de ${l.total} filas procesadas. ${textoPausa(l.motivo_pausa, l.detalle_pausa)}`,
  }
}

/**
 * Correo a quien cargó el lote, una vez por final (completado o pausado), si el lote tiene al menos
 * `FILAS_PARA_AVISO_CORREO` filas: uno chico termina mientras la persona mira. El UPDATE que marca
 * `aviso_enviado_at` es el reclamo: dos trabajadores no mandan dos correos; la `Idempotency-Key` de
 * Resend cubre el reintento. Sin llave de Resend o sin correo, no hay aviso (la pantalla lo muestra).
 */
export async function avisarLote(svc: Svc, loteId: string): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) return
  const { data } = await svc
    .from('valida_lotes')
    .update({ aviso_enviado_at: new Date().toISOString() })
    .eq('id', loteId)
    .is('aviso_enviado_at', null)
    .in('estado', ['completado', 'pausado'])
    .gte('total', FILAS_PARA_AVISO_CORREO)
    .select('id, workspace_id, created_by, titulo, estado, motivo_pausa, detalle_pausa, total, procesadas, severidades')
    .maybeSingle()
  const lote = data as (Parameters<typeof textoAvisoLote>[0] & { id: string; workspace_id: string; created_by: string | null }) | null
  if (!lote?.created_by) return

  const [perfil, ws] = await Promise.all([
    svc.from('profiles').select('email').eq('id', lote.created_by).maybeSingle(),
    svc.from('workspaces').select('slug').eq('id', lote.workspace_id).maybeSingle(),
  ])
  const para = ((perfil.data as { email?: string | null } | null)?.email ?? '').trim()
  if (!para) return
  const slug = ((ws.data as { slug?: string | null } | null)?.slug ?? '').trim()
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  const host = slug ? `${slug}.${base}` : base
  const enlace = `${base.startsWith('localhost') ? 'http' : 'https'}://${host}/valida?lote=${lote.id}`
  const { asunto, texto } = textoAvisoLote(lote)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `valida-lote-${lote.id}-${lote.estado}-${lote.procesadas}`,
    },
    body: JSON.stringify({
      from: 'MéTRIK ONE <noreply@metrikone.co>',
      to: [para],
      subject: asunto,
      text: `${texto}\n\nAbrir el cargue: ${enlace}`,
      html:
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1A1A1A">` +
        `<p>${escapar(texto)}</p>` +
        `<p><a href="${escapar(enlace)}" style="color:#059669">Abrir el cargue</a></p></div>`,
    }),
  }).catch((e: unknown) => {
    console.error('[valida-lotes] correo:', (e as Error)?.message ?? e)
    return null
  })
  if (res && !res.ok) console.error('[valida-lotes] correo:', res.status)
}

// ─── El turno de un lote ─────────────────────────────────────────────────────────

/**
 * Corre las filas del lote hasta `hastaMs` con `concurrenciaDelLote` a la vez. Un corte de la bolsa o
 * un rechazo de Valida detiene el turno (no arranca ninguna fila más; las que están en vuelo terminan)
 * y pausa el lote. Devuelve las filas que terminaron.
 */
export async function correrTurno(
  svc: Svc,
  lote: Lote,
  trabajador: string,
  hastaMs: number,
  opciones: { dormir?: (ms: number) => Promise<void>; ahora?: () => number } = {},
): Promise<number> {
  const ahora = opciones.ahora ?? Date.now
  const acceso = await verificarAccesoDelLote(svc, lote, new Date(ahora()))
  if (!acceso.ok) {
    if (acceso.motivo) {
      await pausarLote(svc, lote.id, acceso.motivo, acceso.detalle)
      await avisarLote(svc, lote.id)
    } else {
      console.error(`[valida-lotes] ${lote.id}: no se pudo verificar el acceso (${acceso.detalle}); se reintenta en el siguiente turno`)
      await svc.rpc('valida_lote_cerrar_turno', { p_lote: lote.id, p_trabajador: trabajador })
    }
    return 0
  }

  const ctx: ContextoTurno = { svc, lote, llave: acceso.llave, prueba: acceso.prueba, dormir: opciones.dormir }
  const negocios = new Set<string>()
  let detener: { motivo: MotivoPausa; detalle: string | null } | null = null
  let terminadas = 0

  async function corredor(): Promise<void> {
    while (!detener && ahora() < hastaMs) {
      const { data, error } = await svc.rpc('valida_lote_reclamar_fila', {
        p_lote: lote.id,
        p_trabajador: trabajador,
        p_reclamo_s: FILA_RECLAMO_S,
      })
      if (error) {
        console.error(`[valida-lotes] ${lote.id}: reclamar fila: ${error.message}`)
        return
      }
      const fila = (Array.isArray(data) ? data[0] : data) as FilaLote | undefined
      if (!fila) return
      let r: ResultadoFila
      try {
        r = await procesarFilaLote(ctx, fila)
      } catch (e) {
        // Una falla de la base a mitad de la fila: queda reclamada y vuelve cuando venza el reclamo.
        console.error(`[valida-lotes] ${lote.id} fila ${fila.posicion}:`, (e as Error)?.message ?? e)
        return
      }
      if (r.tipo === 'corte') detener ??= { motivo: r.motivo, detalle: null }
      else if (r.tipo === 'rechazo') detener ??= { motivo: 'valida_rechazo', detalle: r.error }
      else if (r.tipo === 'hecha') {
        terminadas += 1
        if (r.negocioParaScore) negocios.add(r.negocioParaScore)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrenciaDelLote(lote.concurrencia) }, () => corredor()))

  // El score SARLAFT se calcula con la última consulta del negocio: una vez por negocio y turno.
  for (const negocioId of negocios) await recalcularScoreNegocio(lote.workspace_id, negocioId)

  // `detener` lo asignan los corredores: TypeScript no ve la asignación dentro del cierre.
  const pausa = detener as { motivo: MotivoPausa; detalle: string | null } | null
  if (pausa) await pausarLote(svc, lote.id, pausa.motivo, pausa.detalle)
  else await svc.rpc('valida_lote_cerrar_turno', { p_lote: lote.id, p_trabajador: trabajador })
  await avisarLote(svc, lote.id)
  return terminadas
}

// ─── El trabajador ───────────────────────────────────────────────────────────────

export type ResumenTrabajador = { turnos: number; filas: number }

/**
 * Pide turnos hasta agotar `presupuestoMs`. Sin turno disponible: si hay lotes activos (en manos de
 * otro trabajador, o con los cupos llenos) espera y vuelve a pedir, para que el relevo no espere al
 * siguiente minuto del cron; si no hay ninguno, termina.
 */
export async function correrTrabajadorLotes(opciones: {
  presupuestoMs: number
  svc?: Svc
  dormir?: (ms: number) => Promise<void>
  ahora?: () => number
}): Promise<ResumenTrabajador> {
  const svc = opciones.svc ?? createServiceClient()
  const dormir = opciones.dormir ?? dormirReal
  const ahora = opciones.ahora ?? Date.now
  const trabajador = crypto.randomUUID()
  const fin = ahora() + opciones.presupuestoMs
  const resumen: ResumenTrabajador = { turnos: 0, filas: 0 }

  while (ahora() < fin - MARGEN_CIERRE_MS) {
    const { data, error } = await svc.rpc('valida_lote_tomar_turno', {
      p_trabajador: trabajador,
      p_turno_s: TURNO_RECLAMO_S,
      p_max_simultaneos: lotesSimultaneos(),
    })
    if (error) {
      console.error('[valida-lotes] tomar turno:', error.message)
      break
    }
    const lote = (Array.isArray(data) ? data[0] : data) as Lote | undefined
    if (!lote) {
      const { count, error: errCuenta } = await svc
        .from('valida_lotes')
        .select('id', { count: 'exact', head: true })
        .in('estado', ['en_cola', 'procesando'])
      if (errCuenta || !count) break
      await dormir(ESPERA_TURNO_MS)
      continue
    }
    resumen.turnos += 1
    resumen.filas += await correrTurno(svc, lote, trabajador, Math.min(ahora() + TURNO_MS, fin - MARGEN_CIERRE_MS), {
      dormir: opciones.dormir,
      ahora,
    })
  }
  return resumen
}

/** Presupuesto del trabajador que despierta una acción: la página `/valida` tiene `maxDuration = 300`. */
export const PRESUPUESTO_DESPERTAR_MS = 240_000

/**
 * Despierta un trabajador DESPUÉS de responder (`after()`), en la misma invocación. Fuera de un
 * request (pruebas, scripts) `after()` lanza: no se hace nada, el cron lo toma en el siguiente minuto.
 */
export function despertarTrabajador(): void {
  try {
    after(async () => {
      try {
        await correrTrabajadorLotes({ presupuestoMs: PRESUPUESTO_DESPERTAR_MS })
      } catch (e) {
        console.error('[valida-lotes] trabajador:', (e as Error)?.message ?? e)
      }
    })
  } catch {
    // Sin request: el cron de cada minuto lo toma.
  }
}
