import 'server-only'
import { createHash } from 'node:crypto'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enrolarContratosPorCiclo, type DepsEnrolamiento, type ResumenEnrolamiento } from '@/lib/cobros/enrolar-ciclo-servidor'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import { cobrarConTokenEpayco, eliminarTarjetasEpayco, epaycoEnPruebas, ultimosDigitosTarjetaEpayco } from '@/lib/suscripciones/pasarela/epayco'
import type { ResultadoCargo } from '@/lib/suscripciones/pasarela/adapter'
import { anclaDeFila, columnasDeAncla, filtrarPorAncla } from '@/lib/suscripciones-producto/ancla'
import { activarPlanDelEspacio, type ResultadoActivacionEspacio } from './activacion-servidor'
import { TOPE_FALLAS_TECNICAS, cobrarCuotaConTarjeta, fallasTecnicas, pasarElPlanATarjeta, type ResultadoCobroToken } from './cobro-token-servidor'
import { COBRO_TRAS_PRUEBA } from './condiciones-cobro'
import { PRUEBA_DE_LAS_CONDICIONES } from './condiciones'
import {
  antelacionAvisoMs,
  cobroDesdeMs,
  correoAvisoCobro,
  entornoDeCobro,
  pasoDelCobro,
  constanciaConfirmacion,
  correoCobroConfirmado,
  permiteCobroAlConfirmar,
  puedeCancelar,
  textoConfirmacionCobro,
} from './cobro-prueba'
import { titularDelCobro } from './metodo-pago'
import { cancelarSuscripcionEnPrueba } from './suscripcion-prueba-servidor'
import { TERMINOS_PLAN, terminosPlanListos } from './terminos-plan'

/**
 * El cobro del primer mes al cumplirse los 7 días de la prueba, sin clic (Condiciones v2.1, 7.1 literal b).
 * El del literal a (la Empresa confirma antes: consulta 11 o «Activar plan») es `cobrarAlConfirmar`, al
 * final de este archivo, y comparte con este los pasos b a e (`activarYCobrarReclamado`).
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
 *        c. se registra, sobre el contrato que acaba de nacer, la aceptación de los Términos que se
 *           aceptaron EN EL REGISTRO (`aceptarTerminosDelRegistro`, canal `registro`);
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
 * ## Cuándo no cobra
 *
 * Sin los Términos de autoservicio en el código (`terminosPlanListos`) o sin la aceptación en el
 * registro construida (`ACEPTACION_EN_REGISTRO_CONSTRUIDA`), o con un registro que no aceptó Términos
 * (sin `terminos_sha256`: uno de antes del 2026-10-14), el paso de cobro no reclama nada: deja
 * `cobro_detalle = 'esperando_terminos'` y sigue siendo `programado`. Para probar la pasarela en un
 * preview con un registro así existe el ENSAYO (`VALIDA_COBRO_ENSAYO=1`, solo fuera de producción y con
 * ePayco en modo prueba): cobra la tarjeta de prueba directo, sin plan.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any
type Env = Record<string, string | undefined>

/**
 * La aceptación de los Términos de Uso en el MISMO registro (Condiciones 7.1; Términos v2.0 autoservicio
 * 16.2 a 16.4: la acepta «quien marca la casilla», sin cédula ni representante legal). Construida el
 * 2026-10-14: la casilla v1.2 acepta los Términos llenos de la empresa, el registro guarda el texto y su
 * huella, y el día 7 la aceptación se registra sobre el contrato por el canal `registro` de
 * `aceptaciones_terminos` (migración 20261014203000), cuya guarda exige que el documento sea el MISMO
 * texto aceptado y pone la hora, la IP y el correo desde el registro.
 */
export const ACEPTACION_EN_REGISTRO_CONSTRUIDA = true

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
  /** Los Términos aceptados en el registro. Null en un registro de antes del 2026-10-14: no se cobra. */
  terminos_sha256: string | null
  /** Lo que aceptó (`condiciones-2.1+…`): decide si se le puede ofrecer el cobro al confirmar. */
  condiciones_version?: string | null
  cobro_entorno?: string | null
}

const COLUMNAS =
  'id, workspace_id, usuario_id, correo, razon_social, identificacion, slug_creado, metodo_pago_ref, cobro_estado, cobro_programado_at, cobro_aviso_enviado_at, cobro_token_borrado_at, terminos_sha256, condiciones_version, cobro_entorno'

export interface DepsCobroPrueba {
  db: SupabaseClient
  /**
   * Solo este espacio (el reintento a mano en un preview, `?ws=` de `/api/crons/valida-cobro-prueba`).
   * Sin él, todos los registros del despliegue, como siempre.
   */
  soloWorkspaceId?: string
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
  /** Los últimos 4 dígitos de la tarjeta (ePayco), para la confirmación del cobro. */
  ultimos4?: (ref: string | null) => Promise<string | null>
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

export async function enviarPorResend(m: CorreoSaliente): Promise<ResultadoEnvio> {
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

  let consulta = db
    .from('valida_registros')
    .select(COLUMNAS)
    .eq('estado', 'creado')
    .eq('cobro_entorno', entornoDeCobro(env))
    .in('cobro_estado', ['programado', 'cancelado'])
  if (deps.soloWorkspaceId) consulta = consulta.eq('workspace_id', deps.soloWorkspaceId)
  const { data, error } = await consulta
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
  // Los Términos en el código Y aceptados en ESTE registro. Un registro sin ellos no tiene autorización
  // de cobro que se pueda probar con el texto de los Términos (3.5): espera.
  const listos = terminosDelRegistro(deps, r)
  const ensayo = !listos && ensayoPermitido(env)

  if (!listos && !ensayo) {
    await db.from('valida_registros').update({ cobro_detalle: 'esperando_terminos' }).eq('id', r.id).eq('cobro_estado', 'programado')
    resumen.esperandoTerminos += 1
    return
  }

  // a. El reclamo: la única puerta al cobro. Quien no lo gana, no cobra.
  if (!(await reclamarCobro(db, r.id, { cobro_estado: 'cobrando', cobro_intento_at: ahora, updated_at: ahora }))) return

  if (ensayo) {
    await ensayoDeCobro(deps, r, cerrarCobro(db, r.id), resumen)
    return
  }

  const d = await activarYCobrarReclamado(deps, r, ahoraMs)
  anotarDesenlace(resumen, r.id, d)
}

/** Términos en el código, aceptación en el registro construida, y ESTE registro los aceptó. */
function terminosDelRegistro(deps: Pick<DepsCobroPrueba, 'terminosDelRegistroListos'>, r: RegistroCobro): boolean {
  return (deps.terminosDelRegistroListos ?? (() => terminosPlanListos() && ACEPTACION_EN_REGISTRO_CONSTRUIDA))() && Boolean(r.terminos_sha256)
}

/** `programado` → `cobrando`, con la guarda en el update: dos corridas (o el cron y un clic) cobran una vez. */
async function reclamarCobro(db: Db, registroId: string, cambios: Record<string, unknown>): Promise<boolean> {
  const reclamo = await db.from('valida_registros').update(cambios).eq('id', registroId).eq('cobro_estado', 'programado').select('id')
  return !reclamo.error && (reclamo.data ?? []).length > 0
}

type Cerrar = (estado: string, detalle: string, ref?: string | null) => Promise<unknown>

function cerrarCobro(db: Db, registroId: string): Cerrar {
  return (estado, detalle, ref = null) =>
    db
      .from('valida_registros')
      .update({ cobro_estado: estado, cobro_detalle: detalle.slice(0, 300), ...(ref ? { cobro_ref: ref } : {}), updated_at: new Date().toISOString() })
      .eq('id', registroId)
      .eq('cobro_estado', 'cobrando')
}

/** Cómo terminó un cobro reclamado. `reintentar` devolvió la fila a `programado`. */
type Desenlace =
  | { tipo: 'cobrado' }
  | { tipo: 'pendiente' }
  | { tipo: 'rechazado'; mensaje: string }
  /** ePayco no procesó la solicitud (error nuestro de datos): seguro que no cobró. */
  | { tipo: 'no_procesado'; mensaje: string }
  | { tipo: 'revisar'; detalle: string }
  | { tipo: 'reintentar'; detalle: string }

function anotarDesenlace(resumen: ResumenCobroPrueba, registroId: string, d: Desenlace) {
  if (d.tipo === 'cobrado') resumen.cobrados += 1
  else if (d.tipo === 'pendiente') resumen.pendientes += 1
  else if (d.tipo === 'rechazado') resumen.rechazados += 1
  else if (d.tipo === 'revisar') resumen.aRevisar.push({ registroId, detalle: d.detalle })
  else if (d.tipo === 'no_procesado') resumen.aRevisar.push({ registroId, detalle: `no procesado: ${d.mensaje}` })
  else resumen.reintentar.push({ registroId, detalle: d.detalle })
}

/**
 * Pasos b a e sobre una fila YA reclamada (`cobrando`). Lo comparten el cron del día 7 y el cobro al
 * confirmar (`cobrarAlConfirmar`): el mismo plan, la misma cuota 1 y el mismo `cobrarCuotaConTarjeta`,
 * con su intento reclamado en `cobro_intentos_tarjeta`.
 */
async function activarYCobrarReclamado(
  deps: DepsCobroPrueba,
  r: RegistroCobro,
  ahoraMs: number,
  origen: 'dia_7' | 'confirmacion' = 'dia_7',
): Promise<Desenlace> {
  const db = deps.db as Db
  const ahora = new Date(ahoraMs).toISOString()
  const cerrar = cerrarCobro(db, r.id)
  const soltar = async (detalle: string): Promise<Desenlace> => {
    await cerrar('programado', detalle)
    return { tipo: 'reintentar', detalle }
  }

  // b. a d.: se puede repetir sin riesgo. Cualquier falla suelta la fila.
  let fase: 'antes' | 'cobro' = 'antes'
  try {
    if (!r.usuario_id) {
      await cerrar('revisar', 'el registro no tiene persona para activar el plan')
      return { tipo: 'revisar', detalle: 'sin persona' }
    }
    const act = await (deps.activar ?? ((p) => activarPlanDelEspacio(db, { ...p, rut: null, parametrosExtra: { cobro_tras_prueba: true } })))({
      workspaceId: r.workspace_id,
      usuarioId: r.usuario_id,
    })
    if (!act.ok) {
      if (act.error === 'nit_con_contrato') {
        // Un cliente de hoy que se registró a probar: no se le cuelga otro contrato ni se le cobra.
        await cerrar('revisar', 'activacion: nit_con_contrato')
        return { tipo: 'revisar', detalle: 'nit_con_contrato' }
      }
      return soltar(`activacion: ${act.error}`)
    }

    const sc = await db
      .from('servicios_contratados')
      .select('id, workspace_id, negocio_id, suscripcion_id')
      .eq('workspace_pagador_id', r.workspace_id)
      .eq('estado', 'activo')
    const contratos = (sc.data ?? []) as { id: string; workspace_id: string; negocio_id: string | null; suscripcion_id?: string | null }[]
    if (sc.error || contratos.length !== 1) return soltar(`contrato: ${sc.error?.message ?? `${contratos.length} activos`}`)
    const contrato = contratos[0]
    // Desde 20261016 el contrato cuelga de la suscripción; uno anterior, del negocio.
    const ancla = anclaDeFila(contrato)
    if (!ancla) return soltar('contrato sin ancla')

    const acept = await (deps.aceptarTerminos ?? ((p) => aceptarTerminosDelRegistro(deps.db, p)))({ registro: r, contratoId: contrato.id })
    if (!acept.ok) return soltar(`terminos: ${acept.motivo}`)

    const enr = await (deps.enrolar ?? enrolarContratosPorCiclo)({ db: deps.db, contratoId: contrato.id, anclaAt: ahora })
    if (enr.errores.length > 0) return soltar(`enrolamiento: ${enr.errores.map((e) => e.error).join('; ')}`)
    const plan = await filtrarPorAncla(db.from('planes_cobro').select('id').eq('workspace_id', contrato.workspace_id), ancla).maybeSingle()
    if (plan.error || !plan.data) return soltar('sin plan de cobro')
    const planId = plan.data.id as string
    await (deps.pasarATarjeta ?? pasarElPlanATarjeta)({ db: deps.db }, { cobradorId: contrato.workspace_id, planCobroId: planId, ancla })
    const cuota = await db.from('plan_cobro_cuotas').select('id').eq('plan_cobro_id', planId).eq('numero', 1).maybeSingle()
    if (cuota.error || !cuota.data) return soltar('sin cuota 1')

    // Si la confirmación del literal (a) ya se intentó y el banco la rechazó, el del día 7 es el intento 1
    // de la cuota 1 (Condiciones v2.1, 7.5: «el cobro del literal (b) sigue en pie»). Una falla técnica
    // no gasta el intento: se vuelve a reclamar el mismo (`intentoDelDia7`).
    const intento = origen === 'dia_7' ? await intentoDelDia7(db, planId) : 0

    // e. El cobro. Desde aquí no se vuelve a `programado` (salvo el rechazo de la confirmación, 7.5).
    fase = 'cobro'
    const res = await (deps.cobrarCuota ?? cobrarCuotaConTarjeta)(
      { db: deps.db, ahoraMs },
      { cobradorId: contrato.workspace_id, cuotaId: cuota.data.id as string, intento, reintentoTrasConfirmacion: intento === 1 },
    )
    return await registrarResultado(db, res, planId, cerrar, origen === 'confirmacion' ? volverAlDia7(db, r.id, ahoraMs) : null)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (fase === 'antes') return soltar(`error: ${msg}`)
    await cerrar('revisar', `error en el cobro: ${msg}`)
    return { tipo: 'revisar', detalle: msg }
  }
}

/**
 * El intento de la cuota 1 que le toca al cobro del día 7:
 *   - sin intentos, el 0;
 *   - con el 1 ya reclamado, el 1 (si fue una falla técnica, `cobrarCuotaConTarjeta` lo reclama otra vez;
 *     si no, responde `ya_intentado`);
 *   - con el 0 rechazado por el banco (la confirmación del literal a), el 1;
 *   - con el 0 en falla técnica bajo el tope, el MISMO 0: no cuenta como intento.
 */
async function intentoDelDia7(db: Db, planId: string): Promise<number> {
  const q = await db.from('cobro_intentos_tarjeta').select('intento, resultado, referencia, mensaje').eq('plan_cobro_id', planId).eq('numero_cuota', 1)
  if (q.error) throw new Error(`intentos de la cuota 1: ${q.error.message}`)
  const filas = (q.data ?? []) as { intento: number; resultado: string; referencia: string | null; mensaje: string | null }[]
  if (filas.some((f) => f.intento === 1)) return 1
  const cero = filas.find((f) => f.intento === 0)
  if (!cero) return 0
  if (cero.resultado === 'rechazado') return 1
  const n = fallasTecnicas(cero)
  return n !== null && n >= TOPE_FALLAS_TECNICAS ? 1 : 0
}

/**
 * El rechazo del cobro al confirmar NO cierra el registro (7.5 v2.1, decisión del 2026-10-14): la fila
 * vuelve a `programado`, con la marca del rechazo (que impide ofrecer otra confirmación), y conserva su
 * `cobro_programado_at`: el plazo de la prueba sigue igual y el cobro del día 7 sigue en pie.
 */
function volverAlDia7(db: Db, registroId: string, ahoraMs: number) {
  return async (detalle: string) => {
    const ahora = new Date(ahoraMs).toISOString()
    await db
      .from('valida_registros')
      .update({ cobro_estado: 'programado', cobro_detalle: detalle.slice(0, 300), cobro_confirmacion_rechazada_at: ahora, updated_at: ahora })
      .eq('id', registroId)
      .eq('cobro_estado', 'cobrando')
  }
}

async function registrarResultado(
  db: Db,
  res: ResultadoCobroToken,
  planId: string,
  cerrar: Cerrar,
  alRechazo: ((detalle: string) => Promise<void>) | null,
): Promise<Desenlace> {
  switch (res.tipo) {
    case 'aprobado':
    case 'pagada':
      await cerrar('cobrado', res.tipo === 'aprobado' ? res.detalle : 'la cuota 1 ya estaba pagada')
      return { tipo: 'cobrado' }
    case 'pendiente':
    case 'pendiente_previo':
      await cerrar('cobro_pendiente', 'ePayco dejó el cobro pendiente: lo cierra la confirmación')
      return { tipo: 'pendiente' }
    case 'rechazado':
      // 7.5: no se activa el plan y va un enlace de pago (el plan ya volvió a enlace en `cobrarCuotaConTarjeta`).
      // Del literal (a): la prueba sigue y el día 7 se intenta otra vez. Del (b): se cierra.
      if (alRechazo) await alRechazo(`confirmación rechazada: ${res.mensaje}`)
      else await cerrar('rechazado', `rechazado: ${res.mensaje}`)
      return { tipo: 'rechazado', mensaje: res.mensaje }
    case 'no_procesado':
      // Error nuestro (un dato que ePayco pidió), no del banco: no se cobró nada. Del literal (a): la
      // prueba sigue y el día 7 lo intenta otra vez con el plan en la tarjeta, sin enlace automático.
      // Del (b) bajo el tope: vuelve a `programado` con el plan en la tarjeta y la corrida siguiente
      // reclama el MISMO intento (una falla técnica no gasta el intento del calendario).
      if (alRechazo) {
        await alRechazo(`confirmación no procesada (error técnico, sin cobro): ${res.mensaje}`)
      } else if (!res.agotado) {
        await cerrar('programado', `no procesado (error técnico, sin cobro; se reintenta en la próxima corrida): ${res.mensaje}`)
      } else {
        await db.from('planes_cobro').update({ pasarela: 'manual' }).eq('id', planId).eq('pasarela', 'epayco')
        await cerrar('revisar', `no procesado ${TOPE_FALLAS_TECNICAS} veces (error técnico, sin cobro): ${res.mensaje}`)
      }
      return { tipo: 'no_procesado', mensaje: res.mensaje }
    default: {
      // Dudoso: quizá ePayco cobró y no alcanzó a responder. El plan sale de la tarjeta para que nadie
      // (ni el paso 7b) lo vuelva a cobrar; lo revisa una persona contra el panel de ePayco.
      // `ya_intentado` en el primer cobro: otra corrida reclamó el intento y no dejó resultado.
      const detalle = res.tipo === 'error' ? res.mensaje : res.tipo === 'ya_intentado' ? 'el intento ya estaba reclamado sin resultado' : `no_aplica: ${res.motivo}`
      await db.from('planes_cobro').update({ pasarela: 'manual' }).eq('id', planId).eq('pasarela', 'epayco')
      await cerrar('revisar', detalle)
      return { tipo: 'revisar', detalle }
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
  const pagadorCfg = ((ws.data?.config_extra ?? {}) as Record<string, unknown>).valida_pagador as { celular?: string } | undefined
  const celular = pagadorCfg?.celular ?? ''
  const titular = titularDelCobro(pagadorCfg, { nit: r.identificacion, razonSocial: r.razon_social })
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
    pagador: { ...titular, email: r.correo, celular },
  })
  const estado = res.estado === 'aprobado' ? 'cobrado' : res.estado === 'pendiente' ? 'cobro_pendiente' : res.estado === 'rechazado' ? 'rechazado' : 'revisar'
  const ref = res.estado === 'error' ? null : res.externalRef
  const detalle = `ensayo (preview, sin plan): ${res.estado}${res.estado === 'rechazado' || res.estado === 'error' ? ` ${res.mensaje}` : ''}`
  await cerrar(estado, detalle, ref)
  resumen.ensayos.push({ registroId: r.id, estado })
}

/**
 * Deja la constancia de los Términos aceptados EN EL REGISTRO sobre el contrato que acaba de nacer
 * (canal `registro` de `aceptaciones_terminos`). Sin ella no hay plan que cobrar: el enrolamiento solo
 * enrola contratos con aceptación, y la puerta de `/valida` pediría aceptar otra vez.
 *
 * El servidor arma la fila; la BASE la valida y pone la evidencia desde el registro
 * (`aceptaciones_terminos_registro()`): la hora en que se marcó la casilla, la IP, el correo verificado,
 * la razón social y el NIT declarados, y exige que el documento del contrato sea EL MISMO texto
 * aceptado (`texto_sha256 = terminos_sha256`) y que la declaración sea la casilla tal como se marcó.
 *
 * Idempotente: si la corrida anterior la registró y falló después, la encuentra y sigue.
 */
export async function aceptarTerminosDelRegistro(
  dbCliente: SupabaseClient,
  p: { registro: RegistroCobro; contratoId: string },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const db = dbCliente as Db
  const r = p.registro
  if (!r.terminos_sha256 || !r.usuario_id) return { ok: false, motivo: 'registro_sin_terminos' }

  // La casilla que marcó, tal como quedó en lo que aceptó (no la de hoy: puede haber cambiado).
  const reg = await db.from('valida_registros').select('aceptado_texto, aceptado_at').eq('id', r.id).maybeSingle()
  if (reg.error || !reg.data) return { ok: false, motivo: `registro: ${reg.error?.message ?? 'no existe'}` }
  const aceptadoAt = (reg.data as { aceptado_at?: string | null }).aceptado_at ?? null
  const casilla = casillaMarcada((reg.data as { aceptado_texto: string | null }).aceptado_texto)
  if (!casilla) return { ok: false, motivo: 'registro_sin_casilla' }

  const sc = await db
    .from('servicios_contratados')
    .select('id, workspace_id, empresa_id, negocio_id, suscripcion_id')
    .eq('id', p.contratoId)
    .maybeSingle()
  if (sc.error || !sc.data) return { ok: false, motivo: `contrato: ${sc.error?.message ?? 'no existe'}` }
  const contrato = sc.data as { id: string; workspace_id: string; empresa_id: string | null; negocio_id: string | null; suscripcion_id?: string | null }
  const ancla = anclaDeFila(contrato)
  if (!ancla) return { ok: false, motivo: 'contrato sin ancla' }

  // El documento de ESA empresa (o de ESA suscripción) con el texto exacto aceptado en el registro (lo
  // dejó la activación).
  const delCliente = db
    .from('documentos_contractuales_versiones')
    .select('id, titulo, version, texto_sha256, pdf_sha256')
    .eq('workspace_id', contrato.workspace_id)
  const docs = await (ancla.tipo === 'suscripcion' ? delCliente.eq('suscripcion_id', ancla.id) : delCliente.eq('empresa_id', contrato.empresa_id))
    .eq('slug', TERMINOS_PLAN.slug)
    .eq('texto_sha256', r.terminos_sha256)
  if (docs.error) return { ok: false, motivo: `documento: ${docs.error.message}` }
  const lista = (docs.data ?? []) as { id: string; titulo: string; version: string; texto_sha256: string; pdf_sha256: string }[]
  if (lista.length !== 1) return { ok: false, motivo: `documento: ${lista.length} con el texto del registro` }
  const doc = lista[0]

  const previa = await filtrarPorAncla(db.from('aceptaciones_terminos').select('id'), ancla)
    .eq('documento_sha256', doc.pdf_sha256)
    .eq('estado', 'aceptado')
  if (previa.error) return { ok: false, motivo: `aceptación previa: ${previa.error.message}` }
  if ((previa.data ?? []).length > 0) return { ok: true }

  const ins = await db.from('aceptaciones_terminos').insert({
    canal: 'registro',
    estado: 'aceptado',
    workspace_id: contrato.workspace_id,
    ...columnasDeAncla(ancla),
    workspace_cliente_id: r.workspace_id,
    usuario_id: r.usuario_id,
    valida_registro_id: r.id,
    documento_version_id: doc.id,
    documento_titulo: doc.titulo,
    documento_version: doc.version,
    documento_sha256: doc.pdf_sha256,
    texto_documento_sha256: doc.texto_sha256,
    // La declaración es la casilla tal como la marcó (la base comprueba que esté en lo aceptado).
    texto_aceptacion: casilla,
    // La base los reemplaza con los del registro; van para que la fila se lea completa.
    nombre_aceptante: r.correo,
    calidad: 'autorizado',
    empresa_nombre: r.razon_social,
    empresa_nit: r.identificacion,
  })
  if (ins.error) {
    // Otra corrida la registró entre la lectura y el insert.
    if (ins.error.code === '23505') return { ok: true }
    return { ok: false, motivo: `aceptación: ${ins.error.message}` }
  }
  // La suscripción dice desde cuándo rigen sus Términos (la constancia sigue en `aceptaciones_terminos`).
  if (ancla.tipo === 'suscripcion') {
    const u = await db
      .from('suscripciones_producto')
      .update({ terminos_aceptados_at: aceptadoAt ?? new Date().toISOString() })
      .eq('id', ancla.id)
      .is('terminos_aceptados_at', null)
    if (u.error) console.error('[valida-cobro] fecha de aceptación en la suscripción:', ancla.id, u.error.message)
  }
  return { ok: true }
}

/** La casilla dentro de lo aceptado (`textoAceptado`: el bloque «Casilla: …», en un solo renglón). */
export function casillaMarcada(aceptadoTexto: string | null): string | null {
  const m = /(?:^|\n\n)Casilla: ([^\n]+)/.exec(aceptadoTexto ?? '')
  return m ? m[1] : null
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
  // Si el registro ya tenía suscripción (no debería: se cancela antes de activar), su copia de la
  // referencia tampoco sirve ya. Sin la suscripción, no hace nada.
  const sus = await db
    .from('suscripciones_producto')
    .update({ metodo_pago_ref: null, metodo_pago_pasarela: null })
    .eq('valida_registro_id', r.id)
    .not('metodo_pago_ref', 'is', null)
  if (sus?.error) console.error('[valida-cobro] referencia de la tarjeta en la suscripción:', r.id, sus.error.message)
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
  // La suscripción en prueba se cierra con la misma acción (desde /valida o desde /suscripcion).
  await cancelarSuscripcionEnPrueba(db, { workspaceId: p.workspaceId, por: p.por, ahora })
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

// ── El cobro del primer mes al confirmar (Condiciones v2.1, 7.1 literal a) ─────────────────────
//
// Con los cambios del dictamen de Emilio (`dictamen-cobro-consulta-11.md`, 2026-10-14):
//   C6  sin los últimos 4 dígitos no se ofrece: el cobro queda para el día 7;
//   C7  la pantalla dice la renovación mensual y la fecha de corte (`textoConfirmacionCobro`);
//   C8  se cobra solo si el texto que el servidor arma al cobrar es EL MISMO que se mostró (huella),
//       se guarda quién confirmó, y un intento anterior no se pisa sin dejarlo en `activity_log`;
//   C3  después del cobro sale el correo con la fecha, el valor y los 4 dígitos.
// Y la decisión sobre la pregunta de Emilio: si el cobro al confirmar se rechaza, la Empresa conserva la
// prueba y el cobro del día 7 sigue en pie (`volverAlDia7`, intento 1 de la cuota 1).

export type MotivoSinCobroAlConfirmar =
  | 'sin_registro'
  | 'no_es_la_persona'
  | 'sin_cobro_programado'
  | 'otro_entorno'
  | 'condiciones_sin_cobro_al_confirmar'
  | 'esperando_terminos'
  | 'sin_tarjeta'
  | 'confirmacion_rechazada'
  | 'sin_ultimos4'
  | 'texto_distinto'
  | 'sin_bitacora'

/** Las columnas de la constancia (migración 20261014234500). Solo las lee este camino, nunca el cron. */
interface ConstanciaConfirmacion {
  cobro_confirmado_at?: string | null
  cobro_confirmado_por?: string | null
  cobro_confirmado_ip?: string | null
  cobro_confirmado_texto?: string | null
  cobro_confirmacion_rechazada_at?: string | null
}

type RegistroConfirmacion = RegistroCobro & ConstanciaConfirmacion

const COLUMNAS_CONFIRMACION = `${COLUMNAS}, cobro_confirmado_at, cobro_confirmado_por, cobro_confirmado_ip, cobro_confirmado_texto, cobro_confirmacion_rechazada_at`

/**
 * Por qué a ESTE registro no se le puede cobrar al confirmar, o null si sí. Lo exige todo lo que el
 * cron exige para cobrar (Términos aceptados en el registro, tarjeta, el mismo despliegue), menos el
 * aviso de 48 horas y la fecha: esos son del cobro del literal (b). Y además:
 *   - quien confirma es la persona que se registró y aceptó (no otra persona del espacio, ni «Ver como»);
 *   - el registro aceptó un texto que contempla este cobro (Condiciones v2.1 o posterior);
 *   - no tuvo ya una confirmación rechazada: la tarjeta se vuelve a intentar solo el día 7 (7.5).
 */
function motivoSinCobroAlConfirmar(
  deps: Pick<DepsCobroPrueba, 'terminosDelRegistroListos'>,
  r: RegistroConfirmacion | null,
  usuarioId: string,
  env: Env,
): MotivoSinCobroAlConfirmar | null {
  if (!r) return 'sin_registro'
  if (!r.usuario_id || r.usuario_id !== usuarioId) return 'no_es_la_persona'
  if (r.cobro_estado !== 'programado') return 'sin_cobro_programado'
  if (r.cobro_entorno !== entornoDeCobro(env)) return 'otro_entorno'
  if (!permiteCobroAlConfirmar(r.condiciones_version)) return 'condiciones_sin_cobro_al_confirmar'
  if (!terminosDelRegistro(deps, r)) return 'esperando_terminos'
  if (!r.metodo_pago_ref) return 'sin_tarjeta'
  if (r.cobro_confirmacion_rechazada_at) return 'confirmacion_rechazada'
  return null
}

async function registroDelEspacio(db: Db, workspaceId: string): Promise<RegistroConfirmacion | null> {
  const reg = await db.from('valida_registros').select(COLUMNAS_CONFIRMACION).eq('workspace_id', workspaceId).eq('estado', 'creado').maybeSingle()
  if (reg.error) throw new Error(`registro del espacio: ${reg.error.message}`)
  return (reg.data as RegistroConfirmacion | null) ?? null
}

const huella = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

/** La pantalla tal como se muestra, su texto en un renglón y su huella. */
function pantallaDeConfirmacion(p: { ultimos4: string; agotada: boolean }) {
  const t = textoConfirmacionCobro({ valor: COBRO_TRAS_PRUEBA.precio, ultimos4: p.ultimos4, agotada: p.agotada, consultasPrueba: PRUEBA_DE_LAS_CONDICIONES.consultas })
  const texto = constanciaConfirmacion(t)
  return { ...t, texto, huella: huella(texto) }
}

export type OfertaCobroAlConfirmar =
  | { disponible: true; valor: number; ultimos4: string; titulo: string; detalle: string; boton: string; huella: string }
  | { disponible: false; motivo: MotivoSinCobroAlConfirmar }

type DepsOferta = Pick<DepsCobroPrueba, 'db' | 'env' | 'ultimos4' | 'terminosDelRegistroListos'>

/**
 * Lo que muestra la pantalla antes del botón: el valor, los últimos 4 dígitos y la huella del texto, que
 * vuelve con el clic (C8). Sin los 4 dígitos, no hay oferta (C6).
 */
export async function ofertaCobroAlConfirmar(
  deps: DepsOferta,
  p: { workspaceId: string; usuarioId: string; agotada: boolean },
): Promise<OfertaCobroAlConfirmar> {
  const r = await registroDelEspacio(deps.db as Db, p.workspaceId)
  const motivo = motivoSinCobroAlConfirmar(deps, r, p.usuarioId, deps.env ?? process.env)
  if (motivo) return { disponible: false, motivo }
  const ultimos4 = await (deps.ultimos4 ?? ((ref) => ultimosDigitosTarjetaEpayco(ref)))((r as RegistroCobro).metodo_pago_ref)
  if (!ultimos4) return { disponible: false, motivo: 'sin_ultimos4' }
  const pantalla = pantallaDeConfirmacion({ ultimos4, agotada: p.agotada })
  return { disponible: true, valor: COBRO_TRAS_PRUEBA.precio, ultimos4, titulo: pantalla.titulo, detalle: pantalla.detalle, boton: pantalla.boton, huella: pantalla.huella }
}

export type ResultadoCobroAlConfirmar =
  | { tipo: 'cobrado'; ultimos4: string }
  | { tipo: 'pendiente' }
  | { tipo: 'rechazado'; mensaje: string; ultimos4: string }
  /** No se cobró por un error de datos nuestro: la tarjeta no tuvo la culpa. La prueba sigue. */
  | { tipo: 'no_procesado' }
  | { tipo: 'revisar' }
  | { tipo: 'reintentar' }
  /** Otra corrida (el cron, u otro clic) ya reclamó el cobro: este no cobra. */
  | { tipo: 'en_curso' }
  | { tipo: 'no_disponible'; motivo: MotivoSinCobroAlConfirmar }

/**
 * La Empresa confirmó «Activar y pagar»: se cobra el primer mes YA, por el mismo camino del cron del
 * día 7 (reclamo de la fila, activación, aceptación de los Términos del registro, enrolamiento con el
 * ancla de hoy, cuota 1 por token con su intento en `cobro_intentos_tarjeta`).
 *
 * No hay doble cobro con el cron: los dos reclaman la fila con la guarda `cobro_estado = 'programado'`.
 * Quien llega segundo no cobra (el cron ve `cobrado`, o `cobrando` mientras este clic cobra). Y si los
 * dos llegaran a la cuota, el intento 0 de la cuota 1 solo se reclama una vez.
 *
 * La constancia (Ley 527; C4 y C8): cuándo, quién, desde qué IP y el texto exacto que vio. `huella` es
 * la que la pantalla recibió con la oferta: si el texto que se arma ahora (con los 4 dígitos pedidos
 * otra vez a ePayco) no es el mismo, no se cobra. Si hubo un intento anterior que no cobró, se deja en
 * `activity_log` antes de pisarlo; si esa anotación falla, no se cobra.
 *
 * Si la activación falla ANTES del cobro, la fila vuelve a `programado` (no se cobró nada). Si ePayco
 * rechaza, también vuelve a `programado` con la marca del rechazo: conserva la prueba y el cobro del
 * día 7 sigue en pie (7.5).
 */
export async function cobrarAlConfirmar(
  deps: DepsCobroPrueba,
  p: { workspaceId: string; usuarioId: string; agotada: boolean; ip: string | null; huella: string },
): Promise<ResultadoCobroAlConfirmar> {
  const db = deps.db as Db
  const env = deps.env ?? process.env
  const r = await registroDelEspacio(db, p.workspaceId)
  const motivo = motivoSinCobroAlConfirmar(deps, r, p.usuarioId, env)
  if (motivo) return { tipo: 'no_disponible', motivo }
  const registro = r as RegistroConfirmacion

  const ultimos4 = await (deps.ultimos4 ?? ((ref) => ultimosDigitosTarjetaEpayco(ref)))(registro.metodo_pago_ref)
  if (!ultimos4) return { tipo: 'no_disponible', motivo: 'sin_ultimos4' }
  const pantalla = pantallaDeConfirmacion({ ultimos4, agotada: p.agotada })
  if (pantalla.huella !== p.huella) return { tipo: 'no_disponible', motivo: 'texto_distinto' }

  // Un intento anterior que no cobró (la activación falló antes del cobro): a la bitácora, no al olvido.
  if (registro.cobro_confirmado_at) {
    const log = await registrarActividad(
      db,
      {
        workspace_id: registro.workspace_id,
        entidad_tipo: 'workspace',
        entidad_id: registro.workspace_id,
        tipo: 'sistema',
        autor_id: null,
        contenido: `Valida: confirmación anterior del cobro del primer mes, sin cobro (registro ${registro.id}). Confirmó ${registro.cobro_confirmado_por ?? 'sin usuario'} el ${registro.cobro_confirmado_at} desde ${registro.cobro_confirmado_ip ?? 'IP desconocida'}. Vio: ${registro.cobro_confirmado_texto ?? ''}`.slice(0, 1000),
      },
      'valida-cobro-al-confirmar',
    )
    if (!log.ok) return { tipo: 'no_disponible', motivo: 'sin_bitacora' }
  }

  const ahoraMs = deps.ahoraMs ?? Date.now()
  const ahora = new Date(ahoraMs).toISOString()
  const reclamado = await reclamarCobro(db, registro.id, {
    cobro_estado: 'cobrando',
    cobro_intento_at: ahora,
    cobro_confirmado_at: ahora,
    cobro_confirmado_por: p.usuarioId,
    cobro_confirmado_ip: p.ip,
    cobro_confirmado_texto: pantalla.texto,
    updated_at: ahora,
  })
  if (!reclamado) return { tipo: 'en_curso' }

  const d = await activarYCobrarReclamado(deps, registro, ahoraMs, 'confirmacion')
  switch (d.tipo) {
    case 'cobrado':
      await correoDelCobro(deps, registro, ahoraMs, ultimos4)
      return { tipo: 'cobrado', ultimos4 }
    case 'pendiente':
      return { tipo: 'pendiente' }
    case 'rechazado':
      return { tipo: 'rechazado', mensaje: d.mensaje, ultimos4 }
    case 'no_procesado':
      console.error('[valida-cobro] cobro al confirmar no procesado por ePayco:', registro.id, d.mensaje)
      return { tipo: 'no_procesado' }
    case 'revisar':
      console.error('[valida-cobro] cobro al confirmar a revisar:', registro.id, d.detalle)
      return { tipo: 'revisar' }
    default:
      console.error('[valida-cobro] cobro al confirmar sin cobrar:', registro.id, d.detalle)
      return { tipo: 'reintentar' }
  }
}

/**
 * C3: la confirmación del cobro al correo. Si no sale, se registra; el cobro ya está hecho. También la
 * manda la aprobación TARDÍA de un cobro al confirmar que ePayco dejó pendiente (`cargo-tardio-servidor`):
 * la misma llave de idempotencia, así que sale una vez.
 */
export async function correoDelCobro(
  deps: Pick<DepsCobroPrueba, 'enviarCorreo' | 'urlCuenta'>,
  r: Pick<RegistroCobro, 'id' | 'correo' | 'razon_social' | 'slug_creado'>,
  ahoraMs: number,
  ultimos4: string,
): Promise<boolean> {
  const c = correoCobroConfirmado({
    razonSocial: r.razon_social,
    cobradoAt: new Date(ahoraMs).toISOString(),
    valor: COBRO_TRAS_PRUEBA.precio,
    ultimos4,
    urlCuenta: (deps.urlCuenta ?? urlCuentaPorDefecto)(r.slug_creado ?? ''),
  })
  try {
    const envio = await (deps.enviarCorreo ?? enviarPorResend)({
      to: r.correo,
      subject: c.subject,
      html: c.html,
      text: c.text,
      idempotencyKey: `valida-cobro-confirmado-${r.id}`,
    })
    if (!envio.ok) console.error('[valida-cobro] correo del cobro al confirmar no salió:', r.id, envio.error)
    return envio.ok
  } catch (e) {
    console.error('[valida-cobro] correo del cobro al confirmar:', r.id, e instanceof Error ? e.message : e)
    return false
  }
}
