import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContextoSuscripcion } from '@/lib/seccion-suscripcion/contexto-servidor'
import { puedeVerSuscripcion } from '@/lib/seccion-suscripcion/estado'
import { anotarEnAncla } from '@/lib/suscripciones-producto/bitacora'
import { createServiceClient } from '@/lib/supabase/server'
import {
  eliminarTarjetasEpayco,
  epaycoHabilitado,
  registrarClienteEpayco,
  ultimosDigitosTarjetaEpayco,
} from '@/lib/suscripciones/pasarela/epayco'
import { huellaTexto } from '@/lib/valida-api/politica-huella'
import type { LecturaDocumentos } from '@/lib/valida-api/terminos-servidor'
import { documentosDelCliente } from '@/lib/valida-api/terminos-servidor'
import { origenPeticion } from '@/lib/valida-api/contexto'
import { cobrarCuotaConTarjeta, type ResultadoCobroToken } from '@/lib/valida-registro/cobro-token-servidor'
import { leerTarjeta, pagadorParaGuardar, textoProblemaTarjeta } from '@/lib/valida-registro/metodo-pago'
import { cuotasConEstado, type CuotaConEstado } from './pago-pendiente'
import { leerCuentaCda, type LecturaCuenta } from './pago-servidor'
import {
  diaDeRenovacion,
  elegibilidadTarjeta,
  entraAlCobroAutomatico,
  fechasDelFallo,
  pendienteCobrableConTarjeta,
  pendientesFueraDeLaTarjeta,
  PREGUNTA_PENDIENTE,
  proximoCobroTarjeta,
  textoAutorizacionTarjeta,
  textoConfirmacionPendiente,
  textoFalloTarjeta,
  textoPendiente,
  textoTarjetaActiva,
  v15DelEspacio,
  type VistaPagoAutomatico,
} from './tarjeta-cda'
import { tarjetaCdaDelContrato, type TarjetaCda } from './tarjeta-cda-lectura'
import { pesos } from './terminos-v1-5'

/**
 * El lado del servidor del pago automático con tarjeta de un CDA (reglas en `tarjeta-cda.ts`): lo que ve
 * la pestaña Pagos de `/suscripcion`, registrar o cambiar la tarjeta, quitarla, y cobrar lo atrasado con
 * el clic de la persona designada.
 *
 * Quién puede lo decide la acción (`/suscripcion/acciones.ts`: la persona designada en su sesión, nunca
 * «Ver como»); aquí se vuelve a exigir lo propio (D1, D2) con el contexto ya resuelto. Lo que no es del
 * espacio de la sesión se lee con el cliente de servicio, SIEMPRE por los ids del contrato que devolvió
 * `mis_servicios()`.
 *
 * Nada de esto cobra lo atrasado solo: el único camino es `cobrarPendienteConTarjeta`, con la huella del
 * texto que la persona confirmó.
 */

type Ctx = Extract<ContextoSuscripcion, { tipo: 'ok' }>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any
type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface DepsTarjetaCda {
  db?: unknown
  documentos?: () => Promise<LecturaDocumentos>
  cuenta?: (servicioContratadoId: string) => Promise<LecturaCuenta>
  ahoraMs?: number
  epaycoHabilitado?: boolean
  registrarCliente?: typeof registrarClienteEpayco
  ultimos4?: (ref: string) => Promise<string | null>
  eliminarTarjeta?: (ref: string) => Promise<{ ok: true; borradas: number } | { ok: false; error: string }>
  origen?: () => Promise<{ ip: string | null; userAgent: string | null }>
  cobrar?: (p: { cobradorId: string; cuotaId: string; intento: number; manual: true }) => Promise<ResultadoCobroToken>
}

const NO_DISPONIBLE = 'No se pudo leer tu suscripción. Intenta de nuevo en un momento.'
const SIN_PERMISO = 'El pago automático lo maneja la persona designada por tu empresa.'
const SIN_V15 = 'Para registrar la tarjeta primero acepta la versión 1.5 de los Términos.'

interface Base {
  db: Db
  hoy: string
  ahoraMs: number
  doc: NonNullable<ReturnType<typeof v15DelEspacio>['doc']>
  cuotas: CuotaConEstado[]
  dia: number
}

/** Lo que piden la vista y las acciones: la v1.5 aceptada, las cuotas con su estado y el día de renovación. */
async function base(ctx: Ctx, deps: DepsTarjetaCda): Promise<{ ok: true; b: Base } | { ok: false; error: string; aceptaV15?: true; oculto?: true }> {
  const docs = await (deps.documentos ?? documentosDelCliente)()
  if (!docs.ok) return { ok: false, error: NO_DISPONIBLE }
  const v15 = v15DelEspacio(docs.documentos)
  const eleg = elegibilidadTarjeta({
    producto: ctx.producto,
    negocioId: ctx.contrato.negocioId,
    designado: puedeVerSuscripcion({ usuarioId: ctx.entrada.usuarioEfectivoId, designadoId: ctx.designadoId }),
    v15: v15.estado,
    epaycoHabilitado: deps.epaycoHabilitado ?? epaycoHabilitado(),
  })
  if (eleg.estado === 'acepta_v15') return { ok: false, error: SIN_V15, aceptaV15: true }
  if (eleg.estado === 'oculto') return { ok: false, error: SIN_PERMISO, oculto: true }
  const cuenta = await (deps.cuenta ?? leerCuentaCda)(ctx.entrada.servicioContratadoId)
  if (cuenta.estado !== 'ok') return { ok: false, error: NO_DISPONIBLE }
  const ahoraMs = deps.ahoraMs ?? Date.now()
  const hoy = ctx.entrada.hoy
  const cuotas = cuotasConEstado({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy, ahoraISO: new Date(ahoraMs).toISOString() })
  const dia = diaDeRenovacion(v15.doc, cuotas)
  if (!dia || !v15.doc) return { ok: false, error: 'No pudimos leer tu fecha de renovación. Escríbenos y lo resolvemos.' }
  return { ok: true, b: { db: (deps.db ?? createServiceClient()) as Db, hoy, ahoraMs, doc: v15.doc, cuotas, dia } }
}

/** El texto de la casilla que la pantalla del formulario muestra (el día sale del dato). */
export async function autorizacionParaMostrar(
  ctx: Ctx,
  deps: DepsTarjetaCda = {},
): Promise<{ ok: true; texto: string; cambiar: boolean } | { ok: false; error: string; aceptaV15: boolean }> {
  const r = await base(ctx, deps)
  if (!r.ok) return { ok: false, error: r.error, aceptaV15: r.aceptaV15 === true }
  const actual = await tarjetaCdaDelContrato(r.b.db, ctx.contrato.id).catch(() => null)
  return { ok: true, texto: textoAutorizacionTarjeta(r.b.dia), cambiar: actual !== null }
}

/** El texto confirmado del pendiente y su huella: lo que la persona ve es lo que se cobra. */
function textoDelPendiente(pendientes: ReturnType<typeof pendientesFueraDeLaTarjeta>, ultimos4: string | null) {
  const texto = textoPendiente(pendientes)
  const confirmacion = textoConfirmacionPendiente(pendientes, ultimos4)
  return { texto, confirmacion, huella: huellaTexto(`${texto}\n${PREGUNTA_PENDIENTE}\n${confirmacion}`) }
}

/** El bloque de la pestaña Pagos, o `null` si no se muestra (no es un CDA, ePayco apagado, sin v1.5 publicada). */
export async function vistaPagoAutomatico(ctx: Ctx, deps: DepsTarjetaCda = {}): Promise<VistaPagoAutomatico | null> {
  try {
    const r = await base(ctx, deps)
    if (!r.ok) return r.aceptaV15 ? { tipo: 'acepta_v15' } : null
    const { db, hoy, cuotas, dia } = r.b
    const tarjeta = await tarjetaCdaDelContrato(db, ctx.contrato.id)
    if (!tarjeta) return { tipo: 'sin_tarjeta' }

    const resumen = textoTarjetaActiva(tarjeta.ultimos4, proximoCobroTarjeta({ cuotas, cobroDesde: tarjeta.cobroDesde, hoy, diaRenovacion: dia }))
    const fallo = await falloVigente(db, tarjeta, cuotas, hoy)
    const pendientes = pendientesFueraDeLaTarjeta(cuotas, tarjeta.cobroDesde)
    let pendiente: Extract<VistaPagoAutomatico, { tipo: 'activa' }>['pendiente'] = null
    if (pendientes.length > 0) {
      pendiente = pendienteCobrableConTarjeta(pendientes)
        ? { cobrable: true, pregunta: PREGUNTA_PENDIENTE, ...textoDelPendiente(pendientes, tarjeta.ultimos4) }
        : { cobrable: false, texto: textoPendiente(pendientes) }
    }
    return { tipo: 'activa', resumen, fallo, pendiente }
  } catch (e) {
    console.error('[tarjeta-cda] vista:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * El aviso de un cobro rechazado: la primera cuota de la tarjeta con saldo cuyo cobro el banco rechazó
 * (una falla técnica nuestra no se le cuenta a la tarjeta). Sin rechazo, `null`.
 */
async function falloVigente(db: Db, t: TarjetaCda, cuotas: readonly CuotaConEstado[], hoy: string): Promise<string | null> {
  const c = cuotas.find((x) => x.estado !== 'pagada' && x.saldo > 0 && entraAlCobroAutomatico(x, t.cobroDesde))
  if (!c) return null
  const r = await db
    .from('cobro_intentos_tarjeta')
    .select('id')
    .eq('plan_cobro_id', t.planCobroId)
    .eq('numero_cuota', c.numero)
    .eq('resultado', 'rechazado')
    .limit(1)
  if (r.error || (r.data ?? []).length === 0) return null
  return textoFalloTarjeta({ ultimos4: t.ultimos4, fechas: fechasDelFallo({ cuota: c, transicion: t.terminosVigenteDesde, hoy }) })
}

// ── Registrar o cambiar la tarjeta ───────────────────────────────────────────────────────

export interface EntradaTarjetaCda {
  /** Lo que devolvió ePayco.js: token, titular, documento, celular (`DatosTarjeta`). */
  tarjeta: unknown
  /** El texto de la casilla que la pantalla tenía a la vista. */
  autorizacionMostrada: unknown
  acepta: unknown
}

/** El plan de cobro del contrato: uno solo, en enlace (Bold) o ya en la tarjeta. */
async function planDelContrato(db: Db, ctx: Ctx): Promise<{ ok: true; id: string; pasarela: string | null } | { ok: false; error: string }> {
  const r = await db.from('planes_cobro').select('id, pasarela').eq('negocio_id', ctx.contrato.negocioId).eq('workspace_id', ctx.contrato.cobradorId)
  if (r.error) return { ok: false, error: 'No se pudo leer el plan de cobro. Intenta de nuevo.' }
  const planes = (r.data ?? []) as { id: string; pasarela: string | null }[]
  if (planes.length !== 1) return { ok: false, error: 'Tu suscripción no tiene un plan de cobro único. Escríbenos y lo resolvemos.' }
  if (planes[0].pasarela !== 'bold' && planes[0].pasarela !== 'epayco') {
    return { ok: false, error: 'Tu plan de cobro no admite pago automático todavía. Escríbenos y lo resolvemos.' }
  }
  return { ok: true, ...planes[0] }
}

/**
 * Registrar (o cambiar) la tarjeta: comprueba D1 y D2 otra vez, que la casilla que se marcó dice lo que el
 * servidor arma, crea el cliente en ePayco con el token, guarda la constancia y pasa el plan a la tarjeta.
 * Cambiarla cierra la anterior (y pide a ePayco borrarla) y conserva desde qué día cobra sola.
 */
export async function registrarTarjetaCda(
  ctx: Ctx,
  input: EntradaTarjetaCda,
  p: { correo: string | null },
  deps: DepsTarjetaCda = {},
): Promise<Resultado<{ ultimos4: string | null }>> {
  if (input.acepta !== true) return { ok: false, error: 'Marca la casilla para autorizar el cobro a la tarjeta.' }
  const r = await base(ctx, deps)
  if (!r.ok) return { ok: false, error: r.error }
  const { db, hoy, ahoraMs, doc, dia } = r.b
  const texto = textoAutorizacionTarjeta(dia)
  if (input.autorizacionMostrada !== texto) {
    return { ok: false, error: 'El texto de la autorización cambió mientras lo leías. Recarga la página y vuelve a intentarlo.' }
  }
  const t = leerTarjeta(input.tarjeta)
  if (!t.ok) return { ok: false, error: textoProblemaTarjeta(t.problema) }
  if (!p.correo) return { ok: false, error: 'Tu usuario no tiene correo registrado. Escríbenos y lo resolvemos.' }
  if (!ctx.contrato.negocioId) return { ok: false, error: SIN_PERMISO }

  const plan = await planDelContrato(db, ctx)
  if (!plan.ok) return plan
  let previa: TarjetaCda | null
  try {
    previa = await tarjetaCdaDelContrato(db, ctx.contrato.id)
  } catch {
    return { ok: false, error: NO_DISPONIBLE }
  }

  const cliente = await (deps.registrarCliente ?? registrarClienteEpayco)({
    cardTokenId: t.tarjeta.token,
    // El documento del TITULAR de la tarjeta, no el NIT del CDA: ePayco los compara (eControl).
    pagador: {
      tipoDocumento: t.tarjeta.tipoDocumento,
      documento: t.tarjeta.documento,
      nombre: t.tarjeta.nombres,
      apellido: t.tarjeta.apellidos,
      email: p.correo,
      celular: t.tarjeta.celular,
    },
  })
  if (!cliente.ok) {
    console.error('[tarjeta-cda] ePayco:', cliente.error)
    return { ok: false, error: textoProblemaTarjeta('token') }
  }
  const ultimos4 = await (deps.ultimos4 ?? ((ref: string) => ultimosDigitosTarjetaEpayco(ref)))(cliente.ref).catch(() => null)
  const origen = await (deps.origen ?? origenPeticion)().catch(() => ({ ip: null, userAgent: null }))
  const ahoraISO = new Date(ahoraMs).toISOString()

  // La anterior se cierra antes: la base admite UNA activa por contrato.
  if (previa) {
    const c = await db
      .from('tarjetas_pago_cda')
      .update({ estado: 'reemplazada', cerrada_at: ahoraISO, cerrada_por: ctx.usuarioId })
      .eq('id', previa.id)
      .eq('estado', 'activa')
    if (c.error) return { ok: false, error: 'No se pudo cambiar la tarjeta. Intenta de nuevo.' }
  }
  const pagador = pagadorParaGuardar(t.tarjeta)
  const ins = await db.from('tarjetas_pago_cda').insert({
    workspace_id: ctx.contrato.cobradorId,
    workspace_cliente_id: ctx.workspaceId,
    servicio_contratado_id: ctx.contrato.id,
    negocio_id: ctx.contrato.negocioId,
    plan_cobro_id: plan.id,
    estado: 'activa',
    metodo_pago_ref: cliente.ref,
    ultimos4,
    titular: pagador.titular,
    celular: pagador.celular,
    correo: p.correo,
    // D3: cambiar la tarjeta no adelanta el cobro automático; registrar por primera vez lo fija hoy.
    cobro_desde: previa?.cobroDesde ?? hoy,
    dia_renovacion: dia,
    terminos_documento_id: doc.documentoId,
    terminos_vigente_desde: doc.vigenteDesde.slice(0, 10),
    autorizacion_texto: texto,
    autorizacion_sha256: huellaTexto(texto),
    usuario_id: ctx.usuarioId,
    ip: origen.ip,
    user_agent: origen.userAgent,
    autorizado_at: ahoraISO,
  })
  if (ins.error) {
    console.error('[tarjeta-cda] guardar la tarjeta:', ins.error.message)
    // Sin tarjeta activa el plan no puede quedar en ePayco: sin rechazo, el paso 6 no le mandaría enlaces.
    if (previa) await db.from('planes_cobro').update({ pasarela: 'bold' }).eq('id', plan.id).eq('pasarela', 'epayco')
    await (deps.eliminarTarjeta ?? eliminarTarjetasEpayco)(cliente.ref).catch(() => null)
    return {
      ok: false,
      error: previa
        ? 'No se pudo guardar la tarjeta nueva y la anterior quedó retirada. Vuelve a registrarla; mientras tanto pagas con el enlace.'
        : 'No se pudo guardar la tarjeta. Intenta de nuevo.',
    }
  }
  if (plan.pasarela === 'bold') {
    const u = await db.from('planes_cobro').update({ pasarela: 'epayco' }).eq('id', plan.id).eq('pasarela', 'bold')
    if (u.error) console.error('[tarjeta-cda] pasar el plan a la tarjeta:', u.error.message)
  }
  if (previa) await borrarEnEpayco(db, previa, deps)

  await anotarEnAncla(
    db,
    {
      ancla: { tipo: 'negocio', id: ctx.contrato.negocioId },
      workspaceId: ctx.contrato.cobradorId,
      tipo: previa ? 'tarjeta_cda_cambiada' : 'tarjeta_cda_registrada',
      texto: `${previa ? 'Cambió' : 'Registró'} la tarjeta${ultimos4 ? ` terminada en ${ultimos4}` : ''} del pago automático (Términos v1.5, 2.4). Cobra sola los períodos que empiezan después del ${previa?.cobroDesde ?? hoy}.`,
      datos: { servicio_contratado_id: ctx.contrato.id, plan_cobro_id: plan.id, usuario_id: ctx.usuarioId },
    },
    'tarjeta-cda',
  )
  return { ok: true, ultimos4 }
}

/** Pide a ePayco borrar la tarjeta cerrada y deja la respuesta en su fila. Nunca lanza. */
async function borrarEnEpayco(db: Db, t: TarjetaCda, deps: DepsTarjetaCda): Promise<boolean> {
  const r = await (deps.eliminarTarjeta ?? eliminarTarjetasEpayco)(t.ref).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
  const texto = r.ok ? 'ok' : `error: ${r.error}`.slice(0, 300)
  await db.from('tarjetas_pago_cda').update({ borrado_epayco: texto }).eq('id', t.id)
  if (!r.ok) console.error('[tarjeta-cda] borrar la tarjeta en ePayco:', r.error)
  return r.ok
}

// ── Quitar la tarjeta ────────────────────────────────────────────────────────────────────

/** «Quitar tarjeta»: se cierra, el plan vuelve al enlace de pago (Bold) y se pide a ePayco borrarla. */
export async function quitarTarjetaCda(ctx: Ctx, deps: DepsTarjetaCda = {}): Promise<Resultado<{ borrada: boolean }>> {
  if (ctx.producto !== 'valida_cda' || !ctx.contrato.negocioId) return { ok: false, error: SIN_PERMISO }
  if (!puedeVerSuscripcion({ usuarioId: ctx.entrada.usuarioEfectivoId, designadoId: ctx.designadoId })) return { ok: false, error: SIN_PERMISO }
  const db = (deps.db ?? createServiceClient()) as Db
  let t: TarjetaCda | null
  try {
    t = await tarjetaCdaDelContrato(db, ctx.contrato.id)
  } catch {
    return { ok: false, error: NO_DISPONIBLE }
  }
  if (!t) return { ok: false, error: 'No tienes una tarjeta registrada.' }
  const ahoraISO = new Date(deps.ahoraMs ?? Date.now()).toISOString()
  const c = await db
    .from('tarjetas_pago_cda')
    .update({ estado: 'quitada', cerrada_at: ahoraISO, cerrada_por: ctx.usuarioId })
    .eq('id', t.id)
    .eq('estado', 'activa')
  if (c.error) return { ok: false, error: 'No se pudo quitar la tarjeta. Intenta de nuevo.' }
  const u = await db.from('planes_cobro').update({ pasarela: 'bold' }).eq('id', t.planCobroId).eq('pasarela', 'epayco')
  if (u.error) console.error('[tarjeta-cda] devolver el plan al enlace:', u.error.message)
  const borrada = await borrarEnEpayco(db, t, deps)
  await anotarEnAncla(
    db,
    {
      ancla: { tipo: 'negocio', id: ctx.contrato.negocioId },
      workspaceId: ctx.contrato.cobradorId,
      tipo: 'tarjeta_cda_quitada',
      texto: `Quitó la tarjeta${t.ultimos4 ? ` terminada en ${t.ultimos4}` : ''} del pago automático: el plan vuelve al enlace de pago. Borrado en ePayco: ${borrada ? 'hecho' : 'falló, revisar'}.`,
      datos: { servicio_contratado_id: ctx.contrato.id, plan_cobro_id: t.planCobroId, usuario_id: ctx.usuarioId },
    },
    'tarjeta-cda',
  )
  return { ok: true, borrada }
}

// ── Lo atrasado, con el clic (D3) ────────────────────────────────────────────────────────

/** El primer intento libre de la cuota (0, 1 o 2), o `null` si hay uno en curso o pendiente, o ya no queda. */
async function intentoLibre(db: Db, planCobroId: string, numero: number): Promise<number | null> {
  const r = await db.from('cobro_intentos_tarjeta').select('intento, resultado').eq('plan_cobro_id', planCobroId).eq('numero_cuota', numero)
  if (r.error) return null
  const filas = (r.data ?? []) as { intento: number; resultado: string }[]
  if (filas.some((f) => f.resultado === 'en_curso' || f.resultado === 'pendiente' || f.resultado === 'aprobado')) return null
  for (const i of [0, 1, 2]) if (!filas.some((f) => f.intento === i)) return i
  return null
}

/**
 * «¿Pagarlo ahora con esta tarjeta?»: cobra lo atrasado, un cargo por período, del más viejo al más nuevo.
 * Solo si la huella del texto confirmado es la de lo que se debe AHORA (si algo cambió, no se cobra). Un
 * rechazo o un cargo en revisión frena los siguientes.
 */
export async function cobrarPendienteConTarjeta(ctx: Ctx, huella: unknown, deps: DepsTarjetaCda = {}): Promise<Resultado<{ texto: string }>> {
  const r = await base(ctx, deps)
  if (!r.ok) return { ok: false, error: r.error }
  const { db, cuotas } = r.b
  let t: TarjetaCda | null
  try {
    t = await tarjetaCdaDelContrato(db, ctx.contrato.id)
  } catch {
    return { ok: false, error: NO_DISPONIBLE }
  }
  if (!t) return { ok: false, error: 'No tienes una tarjeta registrada.' }
  const pendientes = pendientesFueraDeLaTarjeta(cuotas, t.cobroDesde)
  if (pendientes.length === 0) return { ok: false, error: 'No tienes nada pendiente fuera del pago automático.' }
  if (!pendienteCobrableConTarjeta(pendientes)) return { ok: false, error: 'Ese pendiente se paga con el enlace de pago de cada cuota.' }
  if (huella !== textoDelPendiente(pendientes, t.ultimos4).huella) {
    return { ok: false, error: 'Lo pendiente cambió mientras lo leías. Recarga la página y vuelve a revisarlo.' }
  }

  const cobrar =
    deps.cobrar ??
    ((p: { cobradorId: string; cuotaId: string; intento: number; manual: true }) =>
      cobrarCuotaConTarjeta({ db: db as SupabaseClient, ahoraMs: deps.ahoraMs }, p))
  let cobrado = 0
  for (const p of pendientes) {
    const intento = await intentoLibre(db, t.planCobroId, p.numero)
    if (intento === null) {
      return { ok: false, error: `El período ${p.periodo} ya tiene un cobro con la tarjeta en curso o sin intentos libres. Págalo con el enlace de pago.` }
    }
    const res = await cobrar({ cobradorId: ctx.contrato.cobradorId, cuotaId: p.cuotaId as string, intento, manual: true })
    if (res.tipo === 'aprobado' || res.tipo === 'pagada') {
      cobrado += p.saldo
      continue
    }
    const antes = cobrado > 0 ? `Se cobraron ${pesos(cobrado)}. ` : ''
    if (res.tipo === 'pendiente' || res.tipo === 'pendiente_previo') {
      return { ok: true, texto: `${antes}El cobro del período ${p.periodo} quedó en revisión en ePayco: te avisamos cuando se confirme.` }
    }
    if (res.tipo === 'rechazado') {
      return { ok: false, error: `${antes}El banco rechazó el cobro del período ${p.periodo}: ${res.mensaje}. No se cobró ese período; puedes pagarlo con el enlace de pago.` }
    }
    return { ok: false, error: `${antes}No se pudo cobrar el período ${p.periodo}. No se cobró ese período; intenta más tarde o págalo con el enlace de pago.` }
  }
  const tarjeta = t.ultimos4 ? `tu tarjeta terminada en ${t.ultimos4}` : 'tu tarjeta'
  return { ok: true, texto: `Listo: se cobraron ${pesos(cobrado)} a ${tarjeta}.` }
}
