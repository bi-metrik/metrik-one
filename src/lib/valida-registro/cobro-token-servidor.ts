import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { anclaDeFila, columnasDeAncla, filtrarPorAncla, type Ancla } from '@/lib/suscripciones-producto/ancla'
import { anotarEnAncla } from '@/lib/suscripciones-producto/bitacora'
import { referenciaEnlaceCobro } from '@/lib/cobros/referencia-enlace'
import { procesarEventoPasarela } from '@/lib/cobros/pago-en-linea'
import { repoPagoEnLinea } from '@/lib/cobros/pago-en-linea-servidor'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { epaycoHabilitado, leerRefMedioPagoEpayco } from '@/lib/suscripciones/pasarela/epayco'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import { CALENDARIO_MORA, esEspacioAutogestion, intentoDelDia } from './plan'
import { titularDelCobro } from './metodo-pago'

/**
 * El cobro recurrente con la tarjeta guardada en ePayco, para el plan de Valida de una cuenta
 * autogestionada que la registró (decisión A2). Sin clic del cliente: la cuota que vence se cobra.
 *
 *   - `pasarElPlanATarjeta`: al nacer el plan, si la cuenta tiene tarjeta, su pasarela pasa de `bold`
 *     (enlace) a `epayco` (token). Sin tarjeta, no se toca: sigue el enlace de siempre.
 *   - `cobrarCuotaConTarjeta`: UNA cuota, UN intento del calendario. Idempotente: una cuota pagada o
 *     con un cobro pendiente en ePayco no se vuelve a cobrar, y cada intento (`cobro_intentos_tarjeta`,
 *     llave única por cuota e intento) se reclama ANTES de llamar a ePayco: dos corridas a la vez
 *     cobran una vez. Aprobado → se registra por el MISMO camino del webhook (`procesarEventoPasarela`),
 *     así que abre el mes en Valida (`trasPagoRegistrado`). Pendiente → queda la referencia y lo
 *     cierra la confirmación. Rechazado:
 *       · cuota 1 (el primer cobro): Condiciones 7.5, «No se activa el plan y METRIK envía un enlace
 *         de pago», sin reintento (Términos 3.6). El plan vuelve a `bold` y el paso 6 manda el enlace;
 *       · cuota 2 en adelante: el plan SIGUE en la tarjeta, el paso 6 manda el enlace el mismo día y
 *         se reintenta con la tarjeta los días 3 y 7 (`CALENDARIO_MORA`, Carmen §2.3).
 *   - `cobrarCuotasConTarjeta`: el paso 7b del cron, sobre las cuotas vencidas de los planes `epayco`,
 *     con el intento que toca según los días de mora. Desde el día de la suspensión no se intenta
 *     nada, y tampoco se cobran las cuotas siguientes de ese plan.
 *
 * Con ePayco apagado (`EPAYCO_HABILITADO`) el adaptador no existe y nada de esto cobra.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * El adaptador para cobrar CON TARJETA: el de ePayco solo con `EPAYCO_HABILITADO=1`. Desde el merge
 * con #1182, `adapterPara('epayco')` existe siempre (los links de cobro solo piden las llaves); el
 * cobro sin clic sigue detrás de su interruptor, como antes.
 */
function adapterTarjeta(pasarela: string): PasarelaAdapter | null {
  return pasarela === 'epayco' && epaycoHabilitado() ? adapterPara(pasarela) : null
}

export interface DepsCobroToken {
  db: SupabaseClient
  adapterPara?: (p: string) => PasarelaAdapter | null
  ahoraMs?: number
}

export type ResultadoCobroToken =
  | { tipo: 'no_aplica'; motivo: string }
  | { tipo: 'pagada' | 'pendiente_previo' }
  /** Ese intento del calendario ya se hizo (o lo está haciendo otra corrida): no se vuelve a cobrar. */
  | { tipo: 'ya_intentado' }
  | { tipo: 'aprobado'; cobroId: string; detalle: string }
  | { tipo: 'pendiente'; cobroId: string }
  | { tipo: 'rechazado'; cobroId: string; mensaje: string }
  /**
   * La pasarela NO procesó la solicitud (faltó un dato, la sesión, el comercio): seguro que no cobró, y
   * no es un rechazo del banco. Error nuestro: no se culpa a la tarjeta ni se manda un enlace por él.
   */
  | {
      tipo: 'no_procesado'
      cobroId: string
      mensaje: string
      /** Ya van `TOPE_FALLAS_TECNICAS` fallas técnicas en este intento: no se vuelve a intentar solo. */
      agotado: boolean
    }
  | { tipo: 'error'; mensaje: string }

interface Pagador {
  workspaceId: string
  ref: string
  correo: string
  nit: string
  razonSocial: string
  celular: string | null
  /** El titular de la tarjeta con su documento (o, en un registro viejo, la empresa con su NIT). */
  titular: { tipoDocumento: string; documento: string; nombre: string; apellido: string }
  /** La IP con que la persona dio la orden: la de la confirmación, o la del registro (Condiciones 7.1). */
  ip: string | null
}

/**
 * Un error técnico (la pasarela NO procesó la solicitud: un campo, la sesión, el comercio) no gasta el
 * intento del calendario: la fila del intento queda en `error` con `no_procesado#N: …` y la corrida
 * siguiente la RECLAMA otra vez (misma fila, misma llave única) hasta `TOPE_FALLAS_TECNICAS`. Solo un
 * rechazo del banco (o un resultado dudoso) cuenta como intento. Cada falla técnica queda además en la
 * bitácora del cliente (`cobro_tarjeta_no_procesado`), que solo se agrega: la historia no se pierde
 * aunque la fila del intento se reuse.
 */
export const TOPE_FALLAS_TECNICAS = 3

/**
 * Cuántas fallas técnicas lleva una fila de intento, o `null` si la fila no es de una falla técnica (un
 * rechazo, un aprobado, un error dudoso o un intento en curso: esos no se reclaman). Las filas de antes
 * del 2026-10-19 decían «ePayco no procesó el cobro: …» sin el contador: cuentan como una.
 */
export function fallasTecnicas(fila: { resultado: string | null; referencia?: string | null; mensaje: string | null }): number | null {
  if (fila.resultado !== 'error' || fila.referencia) return null
  const m = /^no_procesado#(\d+):/.exec(fila.mensaje ?? '')
  if (m) return Number(m[1])
  return (fila.mensaje ?? '').startsWith('ePayco no procesó el cobro') ? 1 : null
}

/** La IP de la orden de cobro: la confirmación (literal a) manda; si no hubo, la del registro. */
function ipDeLaOrden(r: { cobro_confirmado_ip?: string | null; ip?: string | null } | null): string | null {
  const ip = (r?.cobro_confirmado_ip || r?.ip || '').trim()
  return ip || null
}

/**
 * La tarjeta y los datos del pagador del contrato (de un negocio o de una suscripción) del cobrador, si es
 * una cuenta autogestionada con tarjeta.
 *
 * - Suscripción (las altas autogestionadas desde 20261016): la tarjeta es la de la suscripción
 *   (`suscripciones_producto.metodo_pago_ref`, copiada del registro al activar) y los datos del pagador,
 *   los que la empresa declaró en ella.
 * - Negocio (las altas anteriores, si las hubo): la del registro del espacio que paga, como antes.
 */
async function pagadorConTarjeta(db: Db, cobradorId: string, ancla: Ancla): Promise<Pagador | null> {
  const sc = await filtrarPorAncla(db.from('servicios_contratados').select('workspace_pagador_id').eq('workspace_id', cobradorId), ancla)
    .in('estado', ['activo', 'pausado'])
  if (sc.error) throw new Error(`contrato de ${ancla.tipo} ${ancla.id}: ${sc.error.message}`)
  const pagadores = [...new Set(((sc.data ?? []) as { workspace_pagador_id: string | null }[]).map((c) => c.workspace_pagador_id).filter(Boolean))] as string[]
  if (pagadores.length !== 1) return null
  if (ancla.tipo === 'suscripcion') return pagadorDeSuscripcion(db, cobradorId, ancla.id, pagadores[0])
  const [ws, reg] = await Promise.all([
    db.from('workspaces').select('config_extra').eq('id', pagadores[0]).maybeSingle(),
    db
      .from('valida_registros')
      .select('metodo_pago_estado, metodo_pago_ref, correo, identificacion, razon_social, ip, cobro_confirmado_ip')
      .eq('workspace_id', pagadores[0])
      .eq('estado', 'creado')
      .maybeSingle(),
  ])
  if (ws.error) throw new Error(`espacio ${pagadores[0]}: ${ws.error.message}`)
  if (reg.error) throw new Error(`registro de ${pagadores[0]}: ${reg.error.message}`)
  const config = (ws.data?.config_extra ?? null) as Record<string, unknown> | null
  const r = reg.data as {
    metodo_pago_estado: string
    metodo_pago_ref: string | null
    correo: string
    identificacion: string
    razon_social: string
    ip: string | null
    cobro_confirmado_ip?: string | null
  } | null
  if (!esEspacioAutogestion(config) || !r || r.metodo_pago_estado !== 'registrado' || !leerRefMedioPagoEpayco(r.metodo_pago_ref)) return null
  const pagadorCfg = (config?.valida_pagador ?? null) as { celular?: unknown } | null
  return {
    workspaceId: pagadores[0],
    ref: r.metodo_pago_ref as string,
    correo: r.correo,
    nit: r.identificacion,
    razonSocial: r.razon_social,
    celular: typeof pagadorCfg?.celular === 'string' ? pagadorCfg.celular : null,
    titular: titularDelCobro(pagadorCfg, { nit: r.identificacion, razonSocial: r.razon_social }),
    ip: ipDeLaOrden(r),
  }
}

/** La suscripción con su tarjeta: viva, del espacio que paga el contrato y con una referencia de ePayco. */
async function pagadorDeSuscripcion(db: Db, cobradorId: string, suscripcionId: string, pagadorId: string): Promise<Pagador | null> {
  const [s, ws] = await Promise.all([
    db
      .from('suscripciones_producto')
      .select('workspace_cliente_id, estado, metodo_pago_pasarela, metodo_pago_ref, correo_facturacion, numero_documento, razon_social, valida_registro_id')
      .eq('id', suscripcionId)
      .eq('workspace_id', cobradorId)
      .maybeSingle(),
    db.from('workspaces').select('config_extra').eq('id', pagadorId).maybeSingle(),
  ])
  if (s.error) throw new Error(`suscripción ${suscripcionId}: ${s.error.message}`)
  if (ws.error) throw new Error(`espacio ${pagadorId}: ${ws.error.message}`)
  const fila = s.data as {
    workspace_cliente_id: string
    estado: string
    metodo_pago_pasarela: string | null
    metodo_pago_ref: string | null
    correo_facturacion: string | null
    numero_documento: string
    razon_social: string
    valida_registro_id?: string | null
  } | null
  if (!fila || fila.estado === 'cancelada' || fila.workspace_cliente_id !== pagadorId) return null
  if (fila.metodo_pago_pasarela !== 'epayco' || !leerRefMedioPagoEpayco(fila.metodo_pago_ref) || !fila.correo_facturacion) return null
  // La IP de la orden vive en el registro del que nació la suscripción (no se copia: es evidencia de él).
  let registro: { ip?: string | null; cobro_confirmado_ip?: string | null } | null = null
  if (fila.valida_registro_id) {
    const reg = await db.from('valida_registros').select('ip, cobro_confirmado_ip').eq('id', fila.valida_registro_id).maybeSingle()
    if (reg.error) throw new Error(`registro de la suscripción ${suscripcionId}: ${reg.error.message}`)
    registro = reg.data
  }
  const config = (ws.data?.config_extra ?? null) as Record<string, unknown> | null
  const pagadorCfg = (config?.valida_pagador ?? null) as { celular?: unknown } | null
  return {
    workspaceId: pagadorId,
    ref: fila.metodo_pago_ref as string,
    correo: fila.correo_facturacion,
    nit: fila.numero_documento,
    razonSocial: fila.razon_social,
    celular: typeof pagadorCfg?.celular === 'string' ? pagadorCfg.celular : null,
    titular: titularDelCobro(pagadorCfg, { nit: fila.numero_documento, razonSocial: fila.razon_social }),
    ip: ipDeLaOrden(registro),
  }
}

/** Al nacer el plan: si la cuenta tiene tarjeta, se cobra por token y no por enlace. */
export async function pasarElPlanATarjeta(deps: DepsCobroToken, p: { cobradorId: string; planCobroId: string; ancla: Ancla }): Promise<boolean> {
  const db = deps.db as Db
  if (!(await pagadorConTarjeta(db, p.cobradorId, p.ancla))) return false
  const u = await db.from('planes_cobro').update({ pasarela: 'epayco' }).eq('id', p.planCobroId).eq('pasarela', 'bold')
  if (u.error) throw new Error(`pasar el plan ${p.planCobroId} a tarjeta: ${u.error.message}`)
  return true
}

/**
 * `intento`: el índice de `CALENDARIO_MORA.intentos` (0 = el día del vencimiento, 1 = día 3, 2 = día 7).
 * La cuota 1 solo tiene el 0.
 */
export async function cobrarCuotaConTarjeta(
  deps: DepsCobroToken,
  p: { cobradorId: string; cuotaId: string; intento?: number; reintentoTrasConfirmacion?: boolean },
): Promise<ResultadoCobroToken> {
  const intento = p.intento ?? 0
  const db = deps.db as Db
  const ahoraMs = deps.ahoraMs ?? Date.now()
  const adapter = (deps.adapterPara ?? adapterTarjeta)('epayco')
  if (!adapter) return { tipo: 'no_aplica', motivo: 'epayco_apagado' }

  const cuota = await db
    .from('plan_cobro_cuotas')
    .select('id, numero, monto, fecha_vencimiento, concepto_detalle, plan_cobro_id')
    .eq('id', p.cuotaId)
    .eq('workspace_id', p.cobradorId)
    .maybeSingle()
  if (cuota.error || !cuota.data) return { tipo: 'error', mensaje: `cuota ${p.cuotaId}: ${cuota.error?.message ?? 'no existe'}` }
  const plan = await db.from('planes_cobro').select('id, negocio_id, suscripcion_id, pasarela, total_cuotas').eq('id', cuota.data.plan_cobro_id).maybeSingle()
  if (plan.error || !plan.data) return { tipo: 'error', mensaje: `plan de la cuota ${p.cuotaId}` }
  if (plan.data.pasarela !== 'epayco') return { tipo: 'no_aplica', motivo: 'plan_sin_tarjeta' }
  const ancla = anclaDeFila(plan.data)
  if (!ancla) return { tipo: 'error', mensaje: `el plan ${plan.data.id} no tiene ancla` }

  const pagador = await pagadorConTarjeta(db, p.cobradorId, ancla)
  if (!pagador) return { tipo: 'no_aplica', motivo: 'sin_tarjeta' }

  // El cobro programado de la cuota (lo mismo que hace el enlace).
  const previo = await db
    .from('cobros')
    .select('id, fecha, anulado_at, external_ref')
    .eq('workspace_id', p.cobradorId)
    .eq('plan_cobro_id', plan.data.id)
    .eq('numero_cuota', cuota.data.numero)
    .eq('tipo_cobro', 'programado')
    .maybeSingle()
  if (previo.error) return { tipo: 'error', mensaje: previo.error.message }
  const fila = previo.data as { id: string; fecha: string | null; anulado_at: string | null; external_ref: string | null } | null
  if (fila?.fecha) return { tipo: 'pagada' }
  if (fila?.anulado_at) return { tipo: 'no_aplica', motivo: 'cobro_anulado' }
  if (fila?.external_ref?.startsWith('epayco-')) return conciliarCargoPendiente(deps, adapter, { id: fila.id, external_ref: fila.external_ref })

  const monto = Math.round(Number(cuota.data.monto))
  let cobroId = fila?.id ?? null
  if (!cobroId) {
    const nuevo = await db
      .from('cobros')
      .insert({
        workspace_id: p.cobradorId,
        ...columnasDeAncla(ancla),
        plan_cobro_id: plan.data.id,
        numero_cuota: cuota.data.numero,
        monto,
        tipo_cobro: 'programado',
        fecha_esperada: cuota.data.fecha_vencimiento,
        // `cobros.fecha` tiene DEFAULT CURRENT_DATE: sin el null explícito nace «pagado».
        fecha: null,
        revisado: false,
        notas: `Cuota ${cuota.data.numero}${plan.data.total_cuotas ? ` de ${plan.data.total_cuotas}` : ''} · cobro con tarjeta (ePayco)`,
        retencion: 0,
      })
      .select('id')
      .single()
    if (nuevo.error || !nuevo.data?.id) return { tipo: 'error', mensaje: `cobro de la cuota: ${nuevo.error?.message ?? 'sin fila'}` }
    cobroId = nuevo.data.id as string
  }

  // El reclamo del intento, ANTES de llamar a ePayco. La llave única (cobro, intento) de la base es la
  // guarda de verdad; la lectura previa solo evita el error en el caso común. Sin la tabla (migración
  // 20261014153000 sin aplicar) no se cobra: es el lado seguro.
  // La cuota 1 tiene un solo intento (Términos 3.6 → Condiciones 7.5), salvo uno: si el intento 0 fue
  // el cobro al confirmar (7.1 literal a) y se rechazó, el del día 7 (literal b) es el intento 1.
  if (cuota.data.numero === 1 && intento !== 0 && !(intento === 1 && p.reintentoTrasConfirmacion)) {
    return { tipo: 'no_aplica', motivo: 'primer_cobro_sin_reintento' }
  }
  const yaHecho = await db
    .from('cobro_intentos_tarjeta')
    .select('id, resultado, referencia, mensaje')
    .eq('plan_cobro_id', plan.data.id)
    .eq('numero_cuota', cuota.data.numero)
    .eq('intento', intento)
    .maybeSingle()
  if (yaHecho.error) return { tipo: 'error', mensaje: `intentos de la tarjeta: ${yaHecho.error.message}` }
  let intentoId: string
  // Fallas técnicas que ya lleva ESTE intento (0 = ninguna: la fila es nueva).
  let previas = 0
  if (yaHecho.data) {
    const fila = yaHecho.data as { id: string; resultado: string | null; referencia: string | null; mensaje: string | null }
    const n = fallasTecnicas(fila)
    // Un rechazo del banco, un cobro hecho o dudoso, o el tope de fallas técnicas: el intento ya se gastó.
    if (n === null || n >= TOPE_FALLAS_TECNICAS) return { tipo: 'ya_intentado' }
    // Se reclama la MISMA fila con la guarda en el update: dos corridas a la vez, una sola cobra.
    const re = await db
      .from('cobro_intentos_tarjeta')
      .update({ resultado: 'en_curso', updated_at: new Date().toISOString() })
      .eq('id', fila.id)
      .eq('resultado', 'error')
      .select('id')
    if (re.error) return { tipo: 'error', mensaje: `reclamar otra vez el intento ${intento}: ${re.error.message}` }
    if ((re.data ?? []).length !== 1) return { tipo: 'ya_intentado' }
    intentoId = fila.id
    previas = n
  } else {
    const reclamo = await db
      .from('cobro_intentos_tarjeta')
      .insert({ workspace_id: p.cobradorId, cobro_id: cobroId, plan_cobro_id: plan.data.id, numero_cuota: cuota.data.numero, intento })
      .select('id')
      .single()
    if (reclamo.error || !reclamo.data?.id) {
      if (reclamo.error?.code === '23505') return { tipo: 'ya_intentado' }
      return { tipo: 'error', mensaje: `reclamar el intento ${intento}: ${reclamo.error?.message ?? 'sin fila'}` }
    }
    intentoId = reclamo.data.id as string
  }
  const anotar = (resultado: string, referenciaPasarela: string | null, mensaje: string | null) =>
    db
      .from('cobro_intentos_tarjeta')
      .update({ resultado, referencia: referenciaPasarela, mensaje: mensaje ? mensaje.slice(0, 300) : null, updated_at: new Date().toISOString() })
      .eq('id', intentoId)

  const referencia = referenciaEnlaceCobro(cobroId as string, ahoraMs)
  const r = await adapter.cobrar({
    referencia,
    suscripcionId: '',
    workspaceId: pagador.workspaceId,
    cobroId: cobroId as string,
    planCobroId: plan.data.id,
    numeroCuota: cuota.data.numero,
    monto,
    moneda: 'COP',
    descripcion: cuota.data.concepto_detalle ?? `Valida · cuota ${cuota.data.numero}`,
    facturaRef: null,
    medioPago: { tipo: 'tarjeta', token_ref: pagador.ref, pasarela: 'epayco' },
    cliente: {
      // El titular de la tarjeta (nombre y documento), como en el alta del cliente: el antifraude de
      // ePayco los compara con los del medio de pago. Nombre y apellido partidos: un «.» no es apellido.
      nombre: pagador.titular.nombre,
      apellido: pagador.titular.apellido,
      email: pagador.correo,
      documento: pagador.titular.documento,
      tipoDocumento: pagador.titular.tipoDocumento,
      celular: pagador.celular,
      ip: pagador.ip,
    },
  })

  if (r.estado === 'aprobado') {
    await anotar('aprobado', r.externalRef, null)
    const hoy = todayBogotaISO(new Date(ahoraMs))
    const salida = await procesarEventoPasarela(
      {
        tipo: 'aprobado',
        eventoId: `cargo-${r.externalRef}`,
        tipoOriginal: 'cargo con token (ePayco)',
        transaccionId: r.externalRef,
        referenciaPago: r.externalRef,
        referencia,
        idEnlace: null,
        monto: r.monto,
        moneda: 'COP',
        ocurridoAt: `${r.fecha}T12:00:00-05:00`,
        crudo: { origen: 'cobro_con_token', cobroId, intento },
      },
      repoPagoEnLinea(deps.db, 'epayco', adapter),
      hoy,
    )
    return { tipo: 'aprobado', cobroId: cobroId as string, detalle: salida.detalle }
  }
  if (r.estado === 'pendiente') {
    await anotar('pendiente', r.externalRef, r.detalle ?? null)
    if (r.externalRef) await db.from('cobros').update({ external_ref: r.externalRef }).eq('id', cobroId).is('fecha', null)
    return { tipo: 'pendiente', cobroId: cobroId as string }
  }
  if (r.estado === 'rechazado') {
    await anotar('rechazado', r.externalRef, `${r.codigo}: ${r.mensaje}`)
    await ramaDeRechazo(db, { cobradorId: p.cobradorId, planCobroId: plan.data.id, ancla, cobroId: cobroId as string, numeroCuota: cuota.data.numero, intento, mensaje: r.mensaje })
    return { tipo: 'rechazado', cobroId: cobroId as string, mensaje: r.mensaje }
  }
  if (r.sinTransaccion) {
    const fallas = previas + 1
    await anotar('error', null, `no_procesado#${fallas}: ${r.mensaje}`)
    await anotarEnAncla(
      db,
      {
        ancla,
        workspaceId: p.cobradorId,
        tipo: 'cobro_tarjeta_no_procesado',
        texto: `ePayco no procesó el cobro con tarjeta de la cuota ${cuota.data.numero} (no hubo transacción ni cobro; falla técnica ${fallas} de ${TOPE_FALLAS_TECNICAS}): ${r.mensaje}`,
        datos: { cobro_id: cobroId, numero_cuota: cuota.data.numero, intento, fallas_tecnicas: fallas },
      },
      'cobro-token-epayco',
    )
    return { tipo: 'no_procesado', cobroId: cobroId as string, mensaje: r.mensaje, agotado: fallas >= TOPE_FALLAS_TECNICAS }
  }
  await anotar('error', null, r.mensaje)
  return { tipo: 'error', mensaje: r.mensaje }
}

/**
 * Lo que sigue a un rechazo del banco, en el momento del cargo o cuando ePayco rechaza DESPUÉS un cargo
 * que dejó pendiente (la confirmación tardía o la conciliación: `cargo-tardio-servidor.ts`). La fila del
 * intento ya quedó en `rechazado`: con eso el paso 6 manda el enlace de esa cuota
 * (`cuotasConTarjetaRechazada`).
 *   - Cuota 1: Condiciones 7.5, el plan vuelve a Bold, sin reintento.
 *   - Las demás: el plan sigue en la tarjeta (los reintentos de los días 3 y 7).
 */
export async function ramaDeRechazo(
  dbCliente: SupabaseClient,
  p: { cobradorId: string; planCobroId: string; ancla: Ancla; cobroId: string; numeroCuota: number; intento: number; mensaje: string; tardio?: boolean },
): Promise<void> {
  const db = dbCliente as Db
  const primerCobro = p.numeroCuota === 1
  const ultimo = p.intento >= CALENDARIO_MORA.intentos.length - 1
  if (primerCobro) await db.from('planes_cobro').update({ pasarela: 'bold' }).eq('id', p.planCobroId).eq('pasarela', 'epayco')
  const sigue = primerCobro
    ? 'Pasa a enlace de pago (primer cobro, sin reintento).'
    : ultimo
      ? `Último intento con la tarjeta; queda el enlace de pago y la suspensión el día ${CALENDARIO_MORA.suspension}.`
      : `Se manda el enlace de pago y se reintenta con la tarjeta el día ${CALENDARIO_MORA.intentos[p.intento + 1]}.`
  await anotarEnAncla(
    db,
    {
      ancla: p.ancla,
      workspaceId: p.cobradorId,
      tipo: 'cobro_tarjeta_rechazado',
      texto: `Cobro con tarjeta (ePayco) rechazado${p.tardio ? ' después de quedar pendiente' : ''} en la cuota ${p.numeroCuota}, intento del día ${CALENDARIO_MORA.intentos[p.intento]}: ${p.mensaje}. ${sigue}`,
      datos: { cobro_id: p.cobroId, numero_cuota: p.numeroCuota, intento: p.intento, ...(p.tardio ? { tardio: true } : {}) },
    },
    'cobro-token-epayco',
  )
}

/**
 * Un cargo que ePayco dejó PENDIENTE (p. ej. la revisión antifraude eControl, «Pendiente por aprobación
 * del comercio») se cierra con la confirmación de ePayco. Si esa confirmación no llega, la cuota quedaba
 * colgada para siempre: el cobro tiene la referencia y aquí se respondía `pendiente_previo` sin mirar.
 * Ahora se CONSULTA a ePayco (`adapter.consultar`) y lo que diga entra por el MISMO camino de la
 * confirmación (`procesarEventoPasarela`) con el MISMO id de evento (`<ref_payco>-<estado>`): si la
 * confirmación llegó o llega después, es un duplicado y no hace nada dos veces.
 *   - aprobado: se registra el pago y `trasPagoRegistrado` cierra el intento y el registro;
 *   - rechazado: el intento pasa a `rechazado` y sigue la rama de rechazo (`trasRechazo`);
 *   - pendiente, o una consulta que no se pudo hacer: sigue `pendiente_previo`. Nunca se cobra otra vez.
 */
async function conciliarCargoPendiente(
  deps: DepsCobroToken,
  adapter: PasarelaAdapter,
  cobro: { id: string; external_ref: string },
): Promise<ResultadoCobroToken> {
  let r: Awaited<ReturnType<PasarelaAdapter['consultar']>>
  try {
    r = await adapter.consultar(cobro.external_ref)
  } catch (e) {
    console.error('[cobro-token] consulta de un cargo pendiente:', cobro.id, e instanceof Error ? e.message : e)
    return { tipo: 'pendiente_previo' }
  }
  if (r.estado !== 'aprobado' && r.estado !== 'rechazado') return { tipo: 'pendiente_previo' }
  const refPayco = cobro.external_ref.replace(/^epayco-/, '')
  const codigo = r.estado === 'aprobado' ? '1' : /^\d+$/.test(r.codigo) ? r.codigo : '2'
  const salida = await procesarEventoPasarela(
    {
      tipo: r.estado,
      eventoId: `${refPayco}-${codigo}`,
      tipoOriginal: `${codigo} ${r.estado === 'aprobado' ? 'Aceptada' : r.mensaje} (consulta)`.slice(0, 120),
      transaccionId: refPayco,
      referenciaPago: cobro.external_ref,
      // La referencia de ONE dice el cobro: la que se mandó a ePayco tenía la hora del cargo, que aquí no hace falta.
      referencia: referenciaEnlaceCobro(cobro.id, deps.ahoraMs ?? Date.now()),
      idEnlace: null,
      monto: r.estado === 'aprobado' ? r.monto : null,
      moneda: 'COP',
      ocurridoAt: r.estado === 'aprobado' ? `${r.fecha}T12:00:00-05:00` : null,
      crudo: { origen: 'conciliacion_consulta', cobroId: cobro.id },
    },
    repoPagoEnLinea(deps.db, 'epayco', adapter),
    todayBogotaISO(new Date(deps.ahoraMs ?? Date.now())),
  )
  if (r.estado === 'aprobado') return { tipo: 'aprobado', cobroId: cobro.id, detalle: salida.detalle }
  return { tipo: 'rechazado', cobroId: cobro.id, mensaje: r.mensaje }
}

export interface ResumenCobroToken {
  revisadas: number
  aprobadas: number
  pendientes: number
  rechazadas: number
  /** Cuotas cuyo intento de hoy ya estaba hecho. */
  yaIntentadas: number
  /** Planes con una cuota en suspensión: no se cobra nada más de ellos. */
  suspendidos: number
  errores: { cuotaId: string; error: string }[]
}

/** Días calendario entre dos fechas 'YYYY-MM-DD'. */
function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

/**
 * El paso 7b del cron: las cuotas vencidas (o que vencen hoy) de los planes que cobran con tarjeta,
 * cada una con el intento que le toca hoy según `CALENDARIO_MORA` (días 0, 3 y 7). Una cuota sin pagar
 * que ya llegó al día de la suspensión frena el plan: no se intenta y no se cobran las siguientes.
 */
export async function cobrarCuotasConTarjeta(deps: DepsCobroToken & { hoy: string; soloPlan?: string }): Promise<ResumenCobroToken> {
  const db = deps.db as Db
  const resumen: ResumenCobroToken = { revisadas: 0, aprobadas: 0, pendientes: 0, rechazadas: 0, yaIntentadas: 0, suspendidos: 0, errores: [] }
  if (!(deps.adapterPara ?? adapterTarjeta)('epayco')) return resumen
  let q = db.from('planes_cobro').select('id, workspace_id').eq('pasarela', 'epayco')
  if (deps.soloPlan) q = q.eq('id', deps.soloPlan)
  const planes = await q
  if (planes.error) throw new Error(`planes con tarjeta: ${planes.error.message}`)
  for (const plan of (planes.data ?? []) as { id: string; workspace_id: string }[]) {
    const [cuotas, cobros] = await Promise.all([
      db
        .from('plan_cobro_cuotas')
        .select('id, numero, fecha_vencimiento')
        .eq('plan_cobro_id', plan.id)
        .lte('fecha_vencimiento', deps.hoy)
        .order('numero'),
      db.from('cobros').select('numero_cuota, fecha').eq('plan_cobro_id', plan.id).eq('tipo_cobro', 'programado'),
    ])
    if (cuotas.error || cobros.error) {
      resumen.errores.push({ cuotaId: `plan:${plan.id}`, error: (cuotas.error ?? cobros.error).message })
      continue
    }
    const pagadas = new Set(
      ((cobros.data ?? []) as { numero_cuota: number | null; fecha: string | null }[]).filter((c) => c.fecha).map((c) => c.numero_cuota),
    )
    for (const c of (cuotas.data ?? []) as { id: string; numero: number; fecha_vencimiento: string }[]) {
      if (pagadas.has(c.numero)) continue
      const dias = diasEntre(c.fecha_vencimiento, deps.hoy)
      if (dias >= CALENDARIO_MORA.suspension) {
        resumen.suspendidos += 1
        break
      }
      const intento = c.numero === 1 ? 0 : intentoDelDia(dias)
      // `intentoDelDia` da un intento cada día de la mora (el último ya hecho, entre uno y otro): una cuota
      // con un cargo pendiente pasa por aquí todos los días y `cobrarCuotaConTarjeta` lo concilia.
      if (intento === null) continue
      resumen.revisadas += 1
      try {
        const r = await cobrarCuotaConTarjeta(deps, { cobradorId: plan.workspace_id, cuotaId: c.id, intento })
        if (r.tipo === 'aprobado') resumen.aprobadas += 1
        else if (r.tipo === 'pendiente') resumen.pendientes += 1
        else if (r.tipo === 'ya_intentado') resumen.yaIntentadas += 1
        else if (r.tipo === 'rechazado') {
          resumen.rechazadas += 1
          // Primer cobro: el plan pasó a enlace. Las demás: la cuota sigue su calendario; no se cobra
          // una cuota más nueva mientras esta esté rechazada.
          break
        } else if (r.tipo === 'error' || r.tipo === 'no_procesado') resumen.errores.push({ cuotaId: c.id, error: r.mensaje })
      } catch (e) {
        resumen.errores.push({ cuotaId: c.id, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
  return resumen
}

/**
 * Las cuotas de planes con tarjeta cuyo cobro con la tarjeta ya fue rechazado: son las ÚNICAS de esos
 * planes que reciben enlace de pago (paso 6 del cron). Antes del rechazo, un enlace invitaría a pagar
 * dos veces lo que la tarjeta va a cobrar sola. Devuelve `plan|numero`.
 */
export async function cuotasConTarjetaRechazada(db: SupabaseClient, planIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (planIds.length === 0) return out
  const r = await (db as Db)
    .from('cobro_intentos_tarjeta')
    .select('plan_cobro_id, numero_cuota')
    .in('plan_cobro_id', [...planIds])
    .eq('resultado', 'rechazado')
  if (r.error) throw new Error(`intentos rechazados: ${r.error.message}`)
  for (const f of (r.data ?? []) as { plan_cobro_id: string; numero_cuota: number }[]) out.add(`${f.plan_cobro_id}|${f.numero_cuota}`)
  return out
}
