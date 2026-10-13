import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enrolarContratosPorCiclo, type DepsEnrolamiento, type ResumenEnrolamiento } from '@/lib/cobros/enrolar-ciclo-servidor'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import { cobrarConTokenEpayco, eliminarTarjetasEpayco, epaycoEnPruebas } from '@/lib/suscripciones/pasarela/epayco'
import type { ResultadoCargo } from '@/lib/suscripciones/pasarela/adapter'
import { activarPlanDelEspacio, type ResultadoActivacionEspacio } from './activacion-servidor'
import { cobrarCuotaConTarjeta, pasarElPlanATarjeta, type ResultadoCobroToken } from './cobro-token-servidor'
import { COBRO_TRAS_PRUEBA } from './condiciones-cobro'
import {
  antelacionAvisoMs,
  cobroDesdeMs,
  correoAvisoCobro,
  entornoDeCobro,
  pasoDelCobro,
  puedeCancelar,
} from './cobro-prueba'
import { partirNombre } from './metodo-pago'
import { terminosPlanListos } from './terminos-plan'

/**
 * El cobro del primer mes al cumplirse los 7 días de la prueba, sin clic (Condiciones v2.0, 7.1 a 7.5).
 * Decisión de Mauricio (2026-10-12): opción A, fecha fija. Corre en el paso 7a del cron
 * `procesar-planes-cobro` y en `/api/crons/valida-cobro-prueba` (para probarlo en un preview).
 *
 * Por cada registro con tarjeta (`cobro_estado = 'programado'`) del MISMO despliegue (`cobro_entorno`:
 * los previews usan la base de producción y no pueden tocar los registros de clientes reales):
 *
 *   1. **Aviso (7.2).** En la corrida que cae en las 72 h previas: un correo con la fecha y la hora,
 *      el valor y cómo cancelar. Se reclama la fila antes de enviar, así que sale una vez.
 *   2. **Cobro.** Solo después del instante exacto Y 48 h después del aviso (`pasoDelCobro`). En orden:
 *        a. se RECLAMA la fila (`programado` → `cobrando`, con la guarda en el update): dos corridas a
 *           la vez, o el cron entregado dos veces, cobran una sola vez;
 *        b. se activa el plan (`activarPlanDelEspacio`, con la persona que se registró y aceptó);
 *        c. se registra la aceptación de los Términos que se aceptaron EN EL REGISTRO (pendiente: ver
 *           `aceptarTerminosDelRegistro`);
 *        d. se enrola el contrato con la cuota 1 el día del cobro (fila 22 de Vera);
 *        e. el plan pasa a la tarjeta y se cobra la cuota 1 por el MISMO camino de las cuotas mensuales
 *           (`cobrarCuotaConTarjeta`): aprobado abre el mes en Valida; rechazado deja el plan sin activar
 *           y en enlace de pago (7.5, sin reintento con la tarjeta: Términos 3.6); pendiente lo cierra la
 *           confirmación de ePayco.
 *      Hasta antes de (e) todo es idempotente y se puede repetir: si algo falla, la fila vuelve a
 *      `programado` y la corrida siguiente lo intenta otra vez. Desde (e), nunca se vuelve atrás: un
 *      resultado dudoso (error de red con ePayco) queda en `revisar` y el plan sale de la tarjeta, para
 *      que ni esta corrida ni el paso 7b vuelvan a cobrar algo que quizá ya se cobró.
 *   3. **Tarjetas de quien canceló** (7.3) que ePayco no alcanzó a borrar: se reintenta el borrado.
 *
 * ## Por qué hoy no cobra (y no puede cobrar) nada
 *
 * Los Términos de Uso de autoservicio no están en el código (`terminos-plan.ts`, marcador) y la
 * aceptación de esos Términos en el registro no está construida (`ACEPTACION_EN_REGISTRO_CONSTRUIDA`).
 * Sin las dos, el paso de cobro no reclama nada: deja `cobro_detalle = 'esperando_terminos'` y sigue
 * siendo `programado`. Para probar la pasarela en un preview existe el ENSAYO (`VALIDA_COBRO_ENSAYO=1`,
 * solo fuera de producción y con ePayco en modo prueba): cobra la tarjeta de prueba directo, sin plan.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any
type Env = Record<string, string | undefined>

/**
 * ⚠️ PENDIENTE. La aceptación de los Términos de Uso en el MISMO registro (Condiciones 7.1; Términos
 * v2.0 autoservicio 16.2 a 16.4: la acepta «quien marca la casilla», sin cédula ni representante legal).
 * Hoy la guarda de la base (`aceptaciones_terminos_modulo()`) exige nombre y cédula de quien acepta y
 * que lo haga la persona designada desde su espacio: para registrar una aceptación hecha en el
 * registro hace falta otro canal en `aceptaciones_terminos` (migración) y decidir con Emilio qué texto
 * de declaración la acompaña. Se cambia a `true` en ese PR.
 */
export const ACEPTACION_EN_REGISTRO_CONSTRUIDA = false

export interface RegistroCobro {
  id: string
  workspace_id: string
  usuario_id: string | null
  correo: string
  razon_social: string
  identificacion: string
  slug_creado: string | null
  metodo_pago_ref: string | null
  cobro_estado: string | null
  cobro_programado_at: string | null
  cobro_aviso_enviado_at: string | null
  cobro_token_borrado_at: string | null
}

const COLUMNAS =
  'id, workspace_id, usuario_id, correo, razon_social, identificacion, slug_creado, metodo_pago_ref, cobro_estado, cobro_programado_at, cobro_aviso_enviado_at, cobro_token_borrado_at'

export interface DepsCobroPrueba {
  db: SupabaseClient
  ahoraMs?: number
  env?: Env
  enviarCorreo?: (m: CorreoSaliente) => Promise<ResultadoEnvio>
  urlCuenta?: (slug: string) => string
  /** Términos escritos Y aceptación en el registro construida. */
  terminosDelRegistroListos?: () => boolean
  activar?: (p: { workspaceId: string; usuarioId: string }) => Promise<ResultadoActivacionEspacio>
  aceptarTerminos?: (p: { registro: RegistroCobro; contratoId: string }) => Promise<{ ok: true } | { ok: false; motivo: string }>
  enrolar?: (p: DepsEnrolamiento) => Promise<ResumenEnrolamiento>
  pasarATarjeta?: typeof pasarElPlanATarjeta
  cobrarCuota?: typeof cobrarCuotaConTarjeta
  eliminarTarjeta?: (ref: string | null) => Promise<{ ok: true; borradas: number } | { ok: false; error: string }>
  /** El cobro directo del ensayo de un preview. */
  cobrarDirecto?: typeof cobrarConTokenEpayco
}

export interface ResumenCobroPrueba {
  avisos: number
  avisosFallidos: { registroId: string; error: string }[]
  esperandoTerminos: number
  cobrados: number
  pendientes: number
  rechazados: number
  aRevisar: { registroId: string; detalle: string }[]
  reintentar: { registroId: string; detalle: string }[]
  ensayos: { registroId: string; estado: string }[]
  tarjetasBorradas: number
  errores: { registroId: string; error: string }[]
}

function urlCuentaPorDefecto(slug: string): string {
  if (process.env.NODE_ENV === 'development') return 'http://localhost:3000/valida'
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${slug}.${base}/valida`
}

const FROM_AVISO = 'Valida · METRIK <facturacion@metrikone.co>'

async function enviarPorResend(m: CorreoSaliente): Promise<ResultadoEnvio> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'sin_resend_api_key' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
    body: JSON.stringify({ from: FROM_AVISO, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  })
  if (!res.ok) return { ok: false, error: `resend_${res.status}` }
  const body = (await res.json().catch(() => ({}))) as { id?: string }
  return { ok: true, id: body.id ?? null }
}

/** El paso del cron. Nunca lanza por un registro: cada uno queda en el resumen. */
export async function procesarCobrosTrasPrueba(deps: DepsCobroPrueba): Promise<ResumenCobroPrueba> {
  const db = deps.db as Db
  const env = deps.env ?? process.env
  const ahoraMs = deps.ahoraMs ?? Date.now()
  const antelacion = antelacionAvisoMs(env)
  const resumen: ResumenCobroPrueba = {
    avisos: 0,
    avisosFallidos: [],
    esperandoTerminos: 0,
    cobrados: 0,
    pendientes: 0,
    rechazados: 0,
    aRevisar: [],
    reintentar: [],
    ensayos: [],
    tarjetasBorradas: 0,
    errores: [],
  }

  const { data, error } = await db
    .from('valida_registros')
    .select(COLUMNAS)
    .eq('estado', 'creado')
    .eq('cobro_entorno', entornoDeCobro(env))
    .in('cobro_estado', ['programado', 'cancelado'])
  if (error) throw new Error(`registros con cobro: ${error.message}`)

  for (const r of (data ?? []) as RegistroCobro[]) {
    try {
      if (r.cobro_estado === 'cancelado') {
        if (!r.cobro_token_borrado_at && r.metodo_pago_ref) {
          if (await borrarTarjeta(deps, r, ahoraMs)) resumen.tarjetasBorradas += 1
        }
        continue
      }
      const paso = pasoDelCobro(r, ahoraMs, antelacion)
      if (paso === 'avisar') await avisar(deps, r, ahoraMs, antelacion, resumen)
      else if (paso === 'cobrar') await cobrar(deps, r, ahoraMs, env, resumen)
    } catch (e) {
      resumen.errores.push({ registroId: r.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return resumen
}

async function avisar(deps: DepsCobroPrueba, r: RegistroCobro, ahoraMs: number, antelacion: number, resumen: ResumenCobroPrueba) {
  const db = deps.db as Db
  const ahora = new Date(ahoraMs).toISOString()
  // Se reclama antes de enviar: dos corridas a la vez mandan un solo correo.
  const reclamo = await db
    .from('valida_registros')
    .update({ cobro_aviso_enviado_at: ahora, updated_at: ahora })
    .eq('id', r.id)
    .eq('cobro_estado', 'programado')
    .is('cobro_aviso_enviado_at', null)
    .select('id')
  if (reclamo.error || (reclamo.data ?? []).length === 0) return

  const programadoMs = Date.parse(r.cobro_programado_at as string)
  const desde = new Date(cobroDesdeMs({ programadoMs, avisoMs: ahoraMs }, antelacion)).toISOString()
  const correo = correoAvisoCobro({
    razonSocial: r.razon_social,
    cobroDesde: desde,
    urlCuenta: (deps.urlCuenta ?? urlCuentaPorDefecto)(r.slug_creado ?? ''),
  })
  const envio = await (deps.enviarCorreo ?? enviarPorResend)({
    to: r.correo,
    subject: correo.subject,
    html: correo.html,
    text: correo.text,
    idempotencyKey: `valida-aviso-cobro-${r.id}`,
  })
  if (envio.ok) {
    resumen.avisos += 1
    return
  }
  // No salió: se suelta para que la corrida siguiente lo intente. Sin aviso no hay cobro.
  await db
    .from('valida_registros')
    .update({ cobro_aviso_enviado_at: null, cobro_detalle: `aviso no enviado: ${envio.error}`.slice(0, 200) })
    .eq('id', r.id)
    .eq('cobro_aviso_enviado_at', ahora)
  resumen.avisosFallidos.push({ registroId: r.id, error: envio.error })
}

/** El ensayo de un preview: cobrar la tarjeta de prueba sin plan, para probar la pasarela. */
function ensayoPermitido(env: Env): boolean {
  return entornoDeCobro(env) !== 'production' && env.VALIDA_COBRO_ENSAYO === '1' && epaycoEnPruebas(env)
}

async function cobrar(deps: DepsCobroPrueba, r: RegistroCobro, ahoraMs: number, env: Env, resumen: ResumenCobroPrueba) {
  const db = deps.db as Db
  const ahora = new Date(ahoraMs).toISOString()
  const listos = (deps.terminosDelRegistroListos ?? (() => terminosPlanListos() && ACEPTACION_EN_REGISTRO_CONSTRUIDA))()
  const ensayo = !listos && ensayoPermitido(env)

  if (!listos && !ensayo) {
    await db.from('valida_registros').update({ cobro_detalle: 'esperando_terminos' }).eq('id', r.id).eq('cobro_estado', 'programado')
    resumen.esperandoTerminos += 1
    return
  }

  // a. El reclamo: la única puerta al cobro. Quien no lo gana, no cobra.
  const reclamo = await db
    .from('valida_registros')
    .update({ cobro_estado: 'cobrando', cobro_intento_at: ahora, updated_at: ahora })
    .eq('id', r.id)
    .eq('cobro_estado', 'programado')
    .select('id')
  if (reclamo.error || (reclamo.data ?? []).length === 0) return

  const cerrar = (estado: string, detalle: string, ref: string | null = null) =>
    db
      .from('valida_registros')
      .update({ cobro_estado: estado, cobro_detalle: detalle.slice(0, 300), ...(ref ? { cobro_ref: ref } : {}), updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('cobro_estado', 'cobrando')
  const soltar = async (detalle: string) => {
    await cerrar('programado', detalle)
    resumen.reintentar.push({ registroId: r.id, detalle })
  }

  if (ensayo) {
    await ensayoDeCobro(deps, r, cerrar, resumen)
    return
  }

  // b. a d.: se puede repetir sin riesgo. Cualquier falla suelta la fila.
  let fase: 'antes' | 'cobro' = 'antes'
  try {
    if (!r.usuario_id) {
      await cerrar('revisar', 'el registro no tiene persona para activar el plan')
      resumen.aRevisar.push({ registroId: r.id, detalle: 'sin persona' })
      return
    }
    const act = await (deps.activar ?? ((p) => activarPlanDelEspacio(db, { ...p, rut: null, parametrosExtra: { cobro_tras_prueba: true } })))({
      workspaceId: r.workspace_id,
      usuarioId: r.usuario_id,
    })
    if (!act.ok) {
      if (act.error === 'nit_con_contrato') {
        // Un cliente de hoy que se registró a probar: no se le cuelga otro contrato ni se le cobra.
        await cerrar('revisar', 'activacion: nit_con_contrato')
        resumen.aRevisar.push({ registroId: r.id, detalle: 'nit_con_contrato' })
      } else await soltar(`activacion: ${act.error}`)
      return
    }

    const sc = await db
      .from('servicios_contratados')
      .select('id, workspace_id, negocio_id')
      .eq('workspace_pagador_id', r.workspace_id)
      .eq('estado', 'activo')
    const contratos = (sc.data ?? []) as { id: string; workspace_id: string; negocio_id: string }[]
    if (sc.error || contratos.length !== 1) return soltar(`contrato: ${sc.error?.message ?? `${contratos.length} activos`}`)
    const contrato = contratos[0]

    const acept = await (deps.aceptarTerminos ?? aceptarTerminosDelRegistro)({ registro: r, contratoId: contrato.id })
    if (!acept.ok) return soltar(`terminos: ${acept.motivo}`)

    const enr = await (deps.enrolar ?? enrolarContratosPorCiclo)({ db: deps.db, contratoId: contrato.id, anclaAt: ahora })
    if (enr.errores.length > 0) return soltar(`enrolamiento: ${enr.errores.map((e) => e.error).join('; ')}`)
    const plan = await db.from('planes_cobro').select('id').eq('workspace_id', contrato.workspace_id).eq('negocio_id', contrato.negocio_id).maybeSingle()
    if (plan.error || !plan.data) return soltar('sin plan de cobro')
    const planId = plan.data.id as string
    await (deps.pasarATarjeta ?? pasarElPlanATarjeta)({ db: deps.db }, { cobradorId: contrato.workspace_id, planCobroId: planId, negocioId: contrato.negocio_id })
    const cuota = await db.from('plan_cobro_cuotas').select('id').eq('plan_cobro_id', planId).eq('numero', 1).maybeSingle()
    if (cuota.error || !cuota.data) return soltar('sin cuota 1')

    // e. El cobro. Desde aquí no se vuelve a `programado`.
    fase = 'cobro'
    const res = await (deps.cobrarCuota ?? cobrarCuotaConTarjeta)({ db: deps.db, ahoraMs }, { cobradorId: contrato.workspace_id, cuotaId: cuota.data.id as string })
    await registrarResultado(db, r, res, planId, cerrar, resumen)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (fase === 'antes') await soltar(`error: ${msg}`)
    else {
      await cerrar('revisar', `error en el cobro: ${msg}`)
      resumen.aRevisar.push({ registroId: r.id, detalle: msg })
    }
  }
}

async function registrarResultado(
  db: Db,
  r: RegistroCobro,
  res: ResultadoCobroToken,
  planId: string,
  cerrar: (estado: string, detalle: string, ref?: string | null) => Promise<unknown>,
  resumen: ResumenCobroPrueba,
) {
  switch (res.tipo) {
    case 'aprobado':
    case 'pagada':
      await cerrar('cobrado', res.tipo === 'aprobado' ? res.detalle : 'la cuota 1 ya estaba pagada')
      resumen.cobrados += 1
      return
    case 'pendiente':
    case 'pendiente_previo':
      await cerrar('cobro_pendiente', 'ePayco dejó el cobro pendiente: lo cierra la confirmación')
      resumen.pendientes += 1
      return
    case 'rechazado':
      // 7.5: no se activa el plan y va un enlace de pago (el plan ya volvió a enlace en `cobrarCuotaConTarjeta`).
      await cerrar('rechazado', `rechazado: ${res.mensaje}`)
      resumen.rechazados += 1
      return
    default: {
      // Dudoso: quizá ePayco cobró y no alcanzó a responder. El plan sale de la tarjeta para que nadie
      // (ni el paso 7b) lo vuelva a cobrar; lo revisa una persona contra el panel de ePayco.
      const detalle = res.tipo === 'error' ? res.mensaje : `no_aplica: ${res.motivo}`
      await db.from('planes_cobro').update({ pasarela: 'manual' }).eq('id', planId).eq('pasarela', 'epayco')
      await cerrar('revisar', detalle)
      resumen.aRevisar.push({ registroId: r.id, detalle })
    }
  }
}

async function ensayoDeCobro(
  deps: DepsCobroPrueba,
  r: RegistroCobro,
  cerrar: (estado: string, detalle: string, ref?: string | null) => Promise<unknown>,
  resumen: ResumenCobroPrueba,
) {
  const db = deps.db as Db
  const ws = await db.from('workspaces').select('config_extra').eq('id', r.workspace_id).maybeSingle()
  const celular = (((ws.data?.config_extra ?? {}) as Record<string, unknown>).valida_pagador as { celular?: string } | undefined)?.celular ?? ''
  const { nombre, apellido } = partirNombre(r.razon_social)
  const referencia = `vpr-${r.id.replace(/-/g, '').slice(0, 20)}`
  const res: ResultadoCargo = await (deps.cobrarDirecto ?? cobrarConTokenEpayco)({
    referencia,
    suscripcionId: '',
    workspaceId: r.workspace_id,
    cobroId: r.id,
    planCobroId: '',
    numeroCuota: 1,
    monto: COBRO_TRAS_PRUEBA.precio,
    moneda: 'COP',
    descripcion: 'Valida · primer mes (ensayo en preview)',
    facturaRef: null,
    medioPago: { tipo: 'tarjeta', token_ref: r.metodo_pago_ref ?? undefined, pasarela: 'epayco' },
    cliente: null,
    pagador: { tipoDocumento: 'NIT', documento: r.identificacion, nombre, apellido, email: r.correo, celular },
  })
  const estado = res.estado === 'aprobado' ? 'cobrado' : res.estado === 'pendiente' ? 'cobro_pendiente' : res.estado === 'rechazado' ? 'rechazado' : 'revisar'
  const ref = res.estado === 'error' ? null : res.externalRef
  const detalle = `ensayo (preview, sin plan): ${res.estado}${res.estado === 'rechazado' || res.estado === 'error' ? ` ${res.mensaje}` : ''}`
  await cerrar(estado, detalle, ref)
  resumen.ensayos.push({ registroId: r.id, estado })
}

/**
 * ⚠️ PENDIENTE (ver `ACEPTACION_EN_REGISTRO_CONSTRUIDA`): deja la constancia de los Términos aceptados
 * en el registro sobre el contrato que acaba de nacer. Mientras no exista, devuelve `pendiente` y el
 * cobro no sigue (la fila vuelve a `programado`): sin Términos aceptados no hay plan que cobrar.
 */
export async function aceptarTerminosDelRegistro(_p: { registro: RegistroCobro; contratoId: string }): Promise<{ ok: true } | { ok: false; motivo: string }> {
  void _p
  return { ok: false, motivo: 'aceptacion_en_registro_pendiente' }
}

async function borrarTarjeta(deps: DepsCobroPrueba, r: RegistroCobro, ahoraMs: number): Promise<boolean> {
  const res = await (deps.eliminarTarjeta ?? ((ref) => eliminarTarjetasEpayco(ref)))(r.metodo_pago_ref)
  const db = deps.db as Db
  if (!res.ok) {
    await db.from('valida_registros').update({ cobro_detalle: `tarjeta sin borrar: ${res.error}`.slice(0, 300) }).eq('id', r.id)
    return false
  }
  const ahora = new Date(ahoraMs).toISOString()
  await db
    .from('valida_registros')
    .update({ cobro_token_borrado_at: ahora, metodo_pago_estado: 'eliminado', updated_at: ahora })
    .eq('id', r.id)
    .is('cobro_token_borrado_at', null)
  return true
}

export type ResultadoCancelacion =
  | { tipo: 'cancelada'; tarjetaBorrada: boolean }
  | { tipo: 'ya_cancelada' }
  | { tipo: 'tarde'; estado: string | null }
  | { tipo: 'sin_cobro' }

/**
 * «Cancelar prueba» (7.3): no se cobra nada y se pide a ePayco borrar la tarjeta. Se cancela mientras
 * ninguna corrida haya empezado a cobrar (`puedeCancelar`); el reclamo del cobro y esta cancelación se
 * excluyen por la guarda `cobro_estado = 'programado'` del update. Cancelar NO quita las consultas que
 * queden de la prueba. Si ePayco no borra ahora, el cron lo reintenta.
 *
 * `por: 'correo'` es la cancelación por correo del 7.3, que registra una persona de METRIK
 * (procedimiento pendiente: fila 16 de Vera).
 */
export async function cancelarCobroDelEspacio(
  deps: Pick<DepsCobroPrueba, 'db' | 'ahoraMs' | 'eliminarTarjeta'>,
  p: { workspaceId: string; por: 'boton' | 'correo' },
): Promise<ResultadoCancelacion> {
  const db = deps.db as Db
  const reg = await db.from('valida_registros').select(COLUMNAS).eq('workspace_id', p.workspaceId).eq('estado', 'creado').maybeSingle()
  if (reg.error) throw new Error(`registro del espacio: ${reg.error.message}`)
  const r = reg.data as RegistroCobro | null
  if (!r || !r.cobro_estado) return { tipo: 'sin_cobro' }
  if (r.cobro_estado === 'cancelado') return { tipo: 'ya_cancelada' }
  if (!puedeCancelar(r.cobro_estado)) return { tipo: 'tarde', estado: r.cobro_estado }

  const ahoraMs = deps.ahoraMs ?? Date.now()
  const ahora = new Date(ahoraMs).toISOString()
  const u = await db
    .from('valida_registros')
    .update({ cobro_estado: 'cancelado', cobro_cancelado_at: ahora, cobro_cancelado_por: p.por, updated_at: ahora })
    .eq('id', r.id)
    .eq('cobro_estado', 'programado')
    .select('id')
  if (u.error) throw new Error(`cancelar: ${u.error.message}`)
  if ((u.data ?? []).length === 0) {
    const otra = await db.from('valida_registros').select('cobro_estado').eq('id', r.id).maybeSingle()
    const estado = (otra.data?.cobro_estado as string | null) ?? null
    return estado === 'cancelado' ? { tipo: 'ya_cancelada' } : { tipo: 'tarde', estado }
  }
  const borrada = r.metodo_pago_ref ? await borrarTarjeta(deps as DepsCobroPrueba, r, ahoraMs) : false
  return { tipo: 'cancelada', tarjetaBorrada: borrada }
}

/** Lo que la cuenta muestra del cobro: la fecha y la hora (7.1) y si todavía se puede cancelar. */
export interface EstadoCobroCuenta {
  estado: string
  programadoAt: string
  cobroDesde: string
  puedeCancelar: boolean
  tarjetaBorrada: boolean
}

export async function estadoCobroDelEspacio(db: SupabaseClient, workspaceId: string, env: Env = process.env): Promise<EstadoCobroCuenta | null> {
  const reg = await (db as Db)
    .from('valida_registros')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .eq('estado', 'creado')
    .maybeSingle()
  const r = reg.data as RegistroCobro | null
  if (reg.error || !r || !r.cobro_estado || !r.cobro_programado_at) return null
  const programadoMs = Date.parse(r.cobro_programado_at)
  const desde = r.cobro_aviso_enviado_at
    ? cobroDesdeMs({ programadoMs, avisoMs: Date.parse(r.cobro_aviso_enviado_at) }, antelacionAvisoMs(env))
    : programadoMs
  return {
    estado: r.cobro_estado,
    programadoAt: r.cobro_programado_at,
    cobroDesde: new Date(desde).toISOString(),
    puedeCancelar: puedeCancelar(r.cobro_estado),
    tarjetaBorrada: Boolean(r.cobro_token_borrado_at),
  }
}
