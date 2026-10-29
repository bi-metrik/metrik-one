import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { llamarValida } from '@/lib/valida-api/cliente'
import type { PeticionValida, ResultadoValida } from '@/lib/valida-api/cliente-nucleo'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import { FRASE_DOBLE_PAGO } from '@/lib/cobros/pago-en-linea'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { anclaDeFila, filtrarPorAncla } from '@/lib/suscripciones-producto/ancla'
import { cuotasConEstado, type CobroRecibido, type CuotaDeServicio } from '@/lib/valida-cda/pago-pendiente'
import { configConCicloReversado, planDeConfig, planSuspendidoPorReverso, referenciaCiclo, type CorteReverso, type PlanAbierto } from './plan'
import {
  avisoClienteHabilitado,
  correoSuspensionPorReverso,
  corteTrasRespuesta,
  mismoDiaDelCorte,
  motivoCorte,
  urlValidaDelEspacio,
  type DatosSuspension,
} from './corte-reverso'

/**
 * El cierre del plan de Valida por el reverso de su pago (decisión de Mauricio, 2026-10-27). Lo que
 * decide es puro (`corte-reverso.ts`); esto lee, llama a Valida y escribe.
 *
 * Quién lo dispara:
 *   1. El reverso detectado (`anularCobroPorReverso`: la confirmación de ePayco con el 6, o el paso 7d
 *      del cron): si el pago reversado abrió el ciclo vigente y NINGÚN otro pago válido cubre la cuota,
 *      deja `valida_plan.reversado.corte` en `pendiente` y llama aquí en el acto.
 *   2. El paso 7f del cron (`reintentarCortesPorReverso`): lo que Valida no respondió (500, red, 503)
 *      y el correo que no salió el mismo día.
 *
 * El estado vive en `workspaces.config_extra.valida_plan.reversado.corte` del espacio que paga: sin
 * columna nueva. Un ciclo nuevo pagado reemplaza `valida_plan` entero y con él la suspensión.
 *
 * Condición de Emilio: un reverso hecho por MéTRIK de un cobro duplicado o indebido NO corta el plan.
 * «Otro pago válido» es (a) plata registrada que, con el reparto FIFO de siempre, sigue cubriendo la
 * cuota sin el pago reversado, o (b) un segundo pago aprobado de ESA cuota que ONE dejó en revisión
 * como «posible doble pago» y que no se reversó.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type LlamarValida = <T>(p: PeticionValida) => Promise<ResultadoValida<T>>

export interface DepsCorte {
  db: SupabaseClient
  llamar?: LlamarValida
  ahora?: () => Date
  enviarCorreo?: (m: CorreoSaliente) => Promise<ResultadoEnvio>
  env?: Record<string, string | undefined>
}

interface CobroReversado {
  id: string
  workspaceId: string
  negocioId: string | null
  suscripcionId?: string | null
}

/**
 * ¿Otro pago válido cubre la cuota del cobro reversado? La explicación, o `null`. Se llama con el cobro
 * YA anulado (no suma en el reparto). Lanza si no puede leer: quien llama no corta a ciegas.
 */
export async function otroPagoValido(dbCliente: SupabaseClient, cobro: CobroReversado, transaccionReversada: string): Promise<string | null> {
  const db = dbCliente as Db
  // (b) Un segundo pago aprobado de esa cuota, sin registrar («posible doble pago») y sin reverso propio.
  const ev = await db.from('pasarela_eventos').select('evento_id, transaccion_id, resultado, detalle').eq('cobro_id', cobro.id)
  if (ev.error) throw new Error(`eventos del cobro ${cobro.id}: ${ev.error.message}`)
  const eventos = (ev.data ?? []) as { evento_id: string; transaccion_id: string; resultado: string; detalle: string | null }[]
  const reversadas = new Set(eventos.filter((e) => /-6$/.test(e.evento_id)).map((e) => e.transaccion_id))
  const duplicado = eventos.find(
    (e) =>
      e.resultado === 'requiere_revision' &&
      (e.detalle ?? '').includes(FRASE_DOBLE_PAGO) &&
      e.transaccion_id !== transaccionReversada &&
      !reversadas.has(e.transaccion_id),
  )
  if (duplicado) return `la cuota tiene otro pago aprobado (transacción ${duplicado.transaccion_id}, en revisión por posible doble pago)`

  // (a) La plata registrada, con el reparto FIFO de la pestaña Pagos.
  const c = await db.from('cobros').select('plan_cobro_id, numero_cuota').eq('id', cobro.id).maybeSingle()
  if (c.error) throw new Error(`leer el cobro ${cobro.id}: ${c.error.message}`)
  const fila = c.data as { plan_cobro_id: string | null; numero_cuota: number | null } | null
  if (!fila?.plan_cobro_id || fila.numero_cuota === null) return null
  const ancla = anclaDeFila({ negocio_id: cobro.negocioId, suscripcion_id: cobro.suscripcionId ?? null })
  if (!ancla) return null
  const planes = await filtrarPorAncla(db.from('planes_cobro').select('id'), ancla).eq('workspace_id', cobro.workspaceId)
  if (planes.error) throw new Error(`planes del cobro ${cobro.id}: ${planes.error.message}`)
  const ids = ((planes.data ?? []) as { id: string }[]).map((p) => p.id)
  if (!ids.includes(fila.plan_cobro_id)) ids.push(fila.plan_cobro_id)
  const [cuotasR, cobrosR] = await Promise.all([
    db.from('plan_cobro_cuotas').select('id, plan_cobro_id, numero, tipo, monto, fecha_vencimiento, concepto_detalle').in('plan_cobro_id', ids),
    filtrarPorAncla(db.from('cobros').select('id, monto, retencion_iva, fecha, anulado_at'), ancla).eq('workspace_id', cobro.workspaceId),
  ])
  if (cuotasR.error) throw new Error(`cuotas del cobro ${cobro.id}: ${cuotasR.error.message}`)
  if (cobrosR.error) throw new Error(`cobros del cobro ${cobro.id}: ${cobrosR.error.message}`)
  const filasCuota = (cuotasR.data ?? []) as { id: string; plan_cobro_id: string; numero: number; tipo: string | null; monto: number | string; fecha_vencimiento: string; concepto_detalle: string | null }[]
  const laCuota = filasCuota.find((q) => q.plan_cobro_id === fila.plan_cobro_id && q.numero === fila.numero_cuota)
  if (!laCuota) return null
  const cuotas: CuotaDeServicio[] = filasCuota.map((q) => ({
    cuotaId: q.id,
    numero: q.numero,
    tipo: q.tipo ?? 'mensual',
    monto: Number(q.monto),
    fechaVencimiento: q.fecha_vencimiento,
    concepto: q.concepto_detalle,
    enlacePagoUrl: null,
    enlacePagoExpira: null,
  }))
  const cobros: CobroRecibido[] = ((cobrosR.data ?? []) as { id: string; monto: number | string | null; retencion_iva: number | string | null; fecha: string | null; anulado_at: string | null }[])
    .filter((x) => x.id !== cobro.id)
    .map((x) => ({
      monto: Number(x.monto ?? 0),
      retencionIva: Number(x.retencion_iva ?? 0),
      estado: x.anulado_at ? 'anulado' : x.fecha === null ? 'programado' : 'pagado',
    }))
  const ahoraISO = new Date().toISOString()
  const estado = cuotasConEstado({ cuotas, cobros, hoy: todayBogotaISO(), ahoraISO }).find((e) => e.cuotaId === laCuota.id)
  return estado?.estado === 'pagada' ? `otros pagos registrados siguen cubriendo la cuota ${laCuota.numero}` : null
}

/**
 * Guarda el corte en el plan, SOLO si el plan sigue siendo el de ese cobro (un ciclo nuevo abierto en
 * el medio ya levantó la suspensión: no se le pega una marca vieja). Relee la configuración antes.
 */
async function guardarCorte(db: Db, workspaceId: string, cobroId: string, corte: CorteReverso): Promise<boolean> {
  const ws = await db.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle()
  if (ws.error) throw new Error(`releer el espacio ${workspaceId}: ${ws.error.message}`)
  const config = ((ws.data?.config_extra ?? {}) as Record<string, unknown>)
  const plan = planDeConfig(config)
  if (!plan?.reversado || plan.cobro_id !== cobroId) return false
  const u = await db.from('workspaces').update({ config_extra: configConCicloReversado(config, plan, { ...plan.reversado, corte }) }).eq('id', workspaceId)
  if (u.error) throw new Error(`guardar el corte del espacio ${workspaceId}: ${u.error.message}`)
  return true
}

interface Registro {
  usuario_id: string | null
  correo: string
  razon_social: string | null
}

async function registroDelEspacio(db: Db, workspaceId: string): Promise<Registro | null> {
  const r = await db.from('valida_registros').select('usuario_id, correo, razon_social').eq('workspace_id', workspaceId).eq('estado', 'creado').maybeSingle()
  if (r.error) throw new Error(`leer el registro del espacio ${workspaceId}: ${r.error.message}`)
  return (r.data as Registro | null) ?? null
}

async function enviarPorDefecto(m: CorreoSaliente): Promise<ResultadoEnvio> {
  // Import dinámico: el módulo del cobro de la prueba importa el del pago en línea (ciclo de módulos).
  const { enviarPorResend } = await import('./cobro-prueba-servidor')
  return enviarPorResend(m)
}

/** El correo al cliente, una vez y el mismo día del corte. Devuelve el corte con el resultado. */
async function avisarCliente(
  db: Db,
  ws: { id: string; slug: string },
  plan: PlanAbierto,
  corte: CorteReverso,
  registro: Registro | null,
  deps: DepsCorte,
  ahora: Date,
): Promise<CorteReverso> {
  const previo = corte.aviso_cliente?.estado
  if (corte.estado !== 'anulado' || previo === 'enviado' || previo === 'retenido' || previo === 'vencido') return corte
  const at = ahora.toISOString()
  let aviso: NonNullable<CorteReverso['aviso_cliente']>
  if (!mismoDiaDelCorte(corte.anulado_en ?? at, ahora.getTime())) {
    aviso = { estado: 'vencido', at, error: 'no salió el día del corte: ya no se manda' }
  } else if (!avisoClienteHabilitado(deps.env ?? process.env)) {
    aviso = { estado: 'retenido', at, error: 'correo retenido en producción (AVISO_REVERSO_CLIENTE_APROBADO = false)' }
  } else if (!registro?.correo) {
    aviso = { estado: 'fallido', at, error: 'el espacio no tiene registro con correo' }
  } else {
    const correo = correoSuspensionPorReverso({
      monto: corte.monto,
      desde: plan.desde,
      hasta: plan.hasta,
      anuladoEn: corte.anulado_en ?? at,
      razonSocial: registro.razon_social ?? 'tu empresa',
      url: urlValidaDelEspacio(ws.slug, deps.env ?? process.env),
    })
    let envio: ResultadoEnvio
    try {
      envio = await (deps.enviarCorreo ?? enviarPorDefecto)({ to: registro.correo, ...correo, idempotencyKey: `valida-reverso-cliente-${plan.cobro_id}` })
    } catch (e) {
      envio = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    aviso = envio.ok ? { estado: 'enviado', at } : { estado: 'fallido', at, error: envio.error }
  }
  const nuevo = { ...corte, aviso_cliente: aviso }
  await guardarCorte(db, ws.id, plan.cobro_id, nuevo)
  return nuevo
}

/**
 * Pide a Valida el cierre del ciclo del espacio (si el corte está `pendiente`) y avisa al cliente (si
 * quedó `anulado` y el correo no salió). Idempotente: Valida también lo es por la referencia. `null` si
 * el espacio no tiene un corte en curso. Lanza solo por errores de base.
 */
export async function cortarCicloEnValida(workspaceId: string, deps: DepsCorte): Promise<CorteReverso | null> {
  const db = deps.db as Db
  const ahora = (deps.ahora ?? (() => new Date()))()
  const ws = await db.from('workspaces').select('id, slug, config_extra').eq('id', workspaceId).maybeSingle()
  if (ws.error) throw new Error(`leer el espacio ${workspaceId}: ${ws.error.message}`)
  const fila = ws.data as { id: string; slug: string; config_extra: Record<string, unknown> | null } | null
  const plan = planDeConfig(fila?.config_extra)
  const corte = plan?.reversado?.corte
  if (!fila || !plan || !corte) return null

  const registro = await registroDelEspacio(db, workspaceId)
  let actual = corte
  if (corte.estado === 'pendiente') {
    const ahoraIso = ahora.toISOString()
    let r: ResultadoValida<{ anulado_en?: string; ya_anulado?: boolean }>
    if (!registro?.usuario_id) {
      r = { tipo: 'no_disponible', motivo: 'respuesta_invalida' }
    } else {
      // El actor es la dueña de la cuenta, el mismo que abrió el ciclo (`ciclo-servidor.ts`).
      const actor = { usuario_id: registro.usuario_id, correo: registro.correo.toLowerCase() }
      r = await (deps.llamar ?? llamarValida)<{ anulado_en?: string; ya_anulado?: boolean }>({
        metodo: 'POST',
        ruta: `/autogestion/${plan.cliente_id}/ciclos/anular`,
        actor,
        cuerpo: { actor, referencia: referenciaCiclo(plan.cobro_id), motivo: motivoCorte(plan.reversado?.referencia_pago ?? plan.cobro_id) },
      })
    }
    actual = corteTrasRespuesta(corte, r, ahoraIso)
    if (!registro?.usuario_id) actual = { ...actual, detalle: `${actual.detalle} El espacio no tiene registro autogestionado con persona.` }
    // Si el plan cambió en el medio (ciclo nuevo pagado), la suspensión ya no aplica: no se escribe.
    if (!(await guardarCorte(db, workspaceId, plan.cobro_id, actual))) return actual
  }
  return avisarCliente(db, fila, plan, actual, registro, deps, ahora)
}

export interface ResumenCortes {
  revisados: number
  anulados: number
  pendientes: { workspaceId: string; detalle: string }[]
  finales: { workspaceId: string; detalle: string }[]
  avisos: number
  errores: { workspaceId: string; error: string }[]
}

/**
 * Paso 7f del cron: los cortes que Valida no respondió y los correos que no salieron. Solo espacios del
 * registro autogestionado con un corte en curso; uno que falle no impide el siguiente.
 */
export async function reintentarCortesPorReverso(deps: DepsCorte): Promise<ResumenCortes> {
  const db = deps.db as Db
  const resumen: ResumenCortes = { revisados: 0, anulados: 0, pendientes: [], finales: [], avisos: 0, errores: [] }
  const ws = await db.from('workspaces').select('id, config_extra').eq('config_extra->>origen_registro', 'valida_autogestion')
  if (ws.error) throw new Error(`espacios autogestionados: ${ws.error.message}`)
  for (const w of (ws.data ?? []) as { id: string; config_extra: Record<string, unknown> | null }[]) {
    const corte = planDeConfig(w.config_extra)?.reversado?.corte
    if (!corte) continue
    const avisoAbierto = corte.estado === 'anulado' && (!corte.aviso_cliente || corte.aviso_cliente.estado === 'fallido')
    if (corte.estado !== 'pendiente' && !avisoAbierto) continue
    resumen.revisados += 1
    try {
      const r = await cortarCicloEnValida(w.id, deps)
      if (!r) continue
      if (r.estado === 'anulado' && corte.estado === 'pendiente') resumen.anulados += 1
      if (r.estado === 'pendiente') resumen.pendientes.push({ workspaceId: w.id, detalle: r.detalle ?? '' })
      if (r.estado === 'final') resumen.finales.push({ workspaceId: w.id, detalle: r.detalle ?? '' })
      if (r.aviso_cliente?.estado === 'enviado' && corte.aviso_cliente?.estado !== 'enviado') resumen.avisos += 1
    } catch (e) {
      resumen.errores.push({ workspaceId: w.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return resumen
}

/**
 * Lo que pinta `/valida` de un plan suspendido por reverso, o `null` si no lo está. Nunca lanza: una
 * lectura caída no tumba la página (sin la razón social se dice «tu empresa»).
 */
export async function suspensionPorReversoEnPantalla(
  dbCliente: SupabaseClient,
  workspaceId: string,
  configExtra: Record<string, unknown> | null,
): Promise<DatosSuspension | null> {
  const plan = planSuspendidoPorReverso(configExtra)
  if (!plan) return null
  let razonSocial = 'tu empresa'
  try {
    const r = await registroDelEspacio(dbCliente as Db, workspaceId)
    if (r?.razon_social) razonSocial = r.razon_social
  } catch {
    // Solo es el nombre.
  }
  const corte = plan.reversado.corte
  return { monto: corte.monto, desde: plan.desde, hasta: plan.hasta, anuladoEn: corte.anulado_en ?? plan.reversado.at, razonSocial }
}
