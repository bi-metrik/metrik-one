import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { referenciaEnlaceCobro } from '@/lib/cobros/referencia-enlace'
import { procesarEventoPasarela } from '@/lib/cobros/pago-en-linea'
import { repoPagoEnLinea } from '@/lib/cobros/pago-en-linea-servidor'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { leerRefMedioPagoEpayco } from '@/lib/suscripciones/pasarela/epayco'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import { CALENDARIO_MORA, esEspacioAutogestion, intentoDelDia } from './plan'

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
  | { tipo: 'error'; mensaje: string }

interface Pagador {
  workspaceId: string
  ref: string
  correo: string
  nit: string
  razonSocial: string
  celular: string | null
}

/** La tarjeta y los datos del pagador de un negocio del cobrador, si es una cuenta autogestionada con tarjeta. */
async function pagadorConTarjeta(db: Db, cobradorId: string, negocioId: string): Promise<Pagador | null> {
  const sc = await db
    .from('servicios_contratados')
    .select('workspace_pagador_id')
    .eq('workspace_id', cobradorId)
    .eq('negocio_id', negocioId)
    .in('estado', ['activo', 'pausado'])
  if (sc.error) throw new Error(`contrato del negocio ${negocioId}: ${sc.error.message}`)
  const pagadores = [...new Set(((sc.data ?? []) as { workspace_pagador_id: string | null }[]).map((c) => c.workspace_pagador_id).filter(Boolean))] as string[]
  if (pagadores.length !== 1) return null
  const [ws, reg] = await Promise.all([
    db.from('workspaces').select('config_extra').eq('id', pagadores[0]).maybeSingle(),
    db
      .from('valida_registros')
      .select('metodo_pago_estado, metodo_pago_ref, correo, identificacion, razon_social')
      .eq('workspace_id', pagadores[0])
      .eq('estado', 'creado')
      .maybeSingle(),
  ])
  if (ws.error) throw new Error(`espacio ${pagadores[0]}: ${ws.error.message}`)
  if (reg.error) throw new Error(`registro de ${pagadores[0]}: ${reg.error.message}`)
  const config = (ws.data?.config_extra ?? null) as Record<string, unknown> | null
  const r = reg.data as { metodo_pago_estado: string; metodo_pago_ref: string | null; correo: string; identificacion: string; razon_social: string } | null
  if (!esEspacioAutogestion(config) || !r || r.metodo_pago_estado !== 'registrado' || !leerRefMedioPagoEpayco(r.metodo_pago_ref)) return null
  const pagadorCfg = (config?.valida_pagador ?? null) as { celular?: unknown } | null
  return {
    workspaceId: pagadores[0],
    ref: r.metodo_pago_ref as string,
    correo: r.correo,
    nit: r.identificacion,
    razonSocial: r.razon_social,
    celular: typeof pagadorCfg?.celular === 'string' ? pagadorCfg.celular : null,
  }
}

/** Al nacer el plan: si la cuenta tiene tarjeta, se cobra por token y no por enlace. */
export async function pasarElPlanATarjeta(deps: DepsCobroToken, p: { cobradorId: string; planCobroId: string; negocioId: string }): Promise<boolean> {
  const db = deps.db as Db
  if (!(await pagadorConTarjeta(db, p.cobradorId, p.negocioId))) return false
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
  const adapter = (deps.adapterPara ?? adapterPara)('epayco')
  if (!adapter) return { tipo: 'no_aplica', motivo: 'epayco_apagado' }

  const cuota = await db
    .from('plan_cobro_cuotas')
    .select('id, numero, monto, fecha_vencimiento, concepto_detalle, plan_cobro_id')
    .eq('id', p.cuotaId)
    .eq('workspace_id', p.cobradorId)
    .maybeSingle()
  if (cuota.error || !cuota.data) return { tipo: 'error', mensaje: `cuota ${p.cuotaId}: ${cuota.error?.message ?? 'no existe'}` }
  const plan = await db.from('planes_cobro').select('id, negocio_id, pasarela, total_cuotas').eq('id', cuota.data.plan_cobro_id).maybeSingle()
  if (plan.error || !plan.data) return { tipo: 'error', mensaje: `plan de la cuota ${p.cuotaId}` }
  if (plan.data.pasarela !== 'epayco') return { tipo: 'no_aplica', motivo: 'plan_sin_tarjeta' }

  const pagador = await pagadorConTarjeta(db, p.cobradorId, plan.data.negocio_id)
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
  if (fila?.external_ref?.startsWith('epayco-')) return { tipo: 'pendiente_previo' }

  const monto = Math.round(Number(cuota.data.monto))
  let cobroId = fila?.id ?? null
  if (!cobroId) {
    const nuevo = await db
      .from('cobros')
      .insert({
        workspace_id: p.cobradorId,
        negocio_id: plan.data.negocio_id,
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
    .select('id')
    .eq('plan_cobro_id', plan.data.id)
    .eq('numero_cuota', cuota.data.numero)
    .eq('intento', intento)
    .maybeSingle()
  if (yaHecho.error) return { tipo: 'error', mensaje: `intentos de la tarjeta: ${yaHecho.error.message}` }
  if (yaHecho.data) return { tipo: 'ya_intentado' }
  const reclamo = await db
    .from('cobro_intentos_tarjeta')
    .insert({ workspace_id: p.cobradorId, cobro_id: cobroId, plan_cobro_id: plan.data.id, numero_cuota: cuota.data.numero, intento })
    .select('id')
    .single()
  if (reclamo.error || !reclamo.data?.id) {
    if (reclamo.error?.code === '23505') return { tipo: 'ya_intentado' }
    return { tipo: 'error', mensaje: `reclamar el intento ${intento}: ${reclamo.error?.message ?? 'sin fila'}` }
  }
  const intentoId = reclamo.data.id as string
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
      nombre: pagador.razonSocial,
      apellido: '.',
      email: pagador.correo,
      documento: pagador.nit,
      tipoDocumento: 'NIT',
      celular: pagador.celular,
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
    const primerCobro = cuota.data.numero === 1
    const ultimo = intento >= CALENDARIO_MORA.intentos.length - 1
    // Cuota 1: Condiciones 7.5, el plan vuelve a Bold, sin reintento. Las demás: el plan sigue en la
    // tarjeta (los reintentos de los días 3 y 7) y el paso 6 del cron manda el enlace de esa cuota.
    if (primerCobro) await db.from('planes_cobro').update({ pasarela: 'bold' }).eq('id', plan.data.id).eq('pasarela', 'epayco')
    const sigue = primerCobro
      ? 'Pasa a enlace de pago (primer cobro, sin reintento).'
      : ultimo
        ? `Último intento con la tarjeta; queda el enlace de pago y la suspensión el día ${CALENDARIO_MORA.suspension}.`
        : `Se manda el enlace de pago y se reintenta con la tarjeta el día ${CALENDARIO_MORA.intentos[intento + 1]}.`
    await registrarActividad(
      db,
      {
        workspace_id: p.cobradorId,
        entidad_tipo: 'negocio',
        entidad_id: plan.data.negocio_id,
        tipo: 'sistema',
        autor_id: null,
        contenido: `Cobro con tarjeta (ePayco) rechazado en la cuota ${cuota.data.numero}, intento del día ${CALENDARIO_MORA.intentos[intento]}: ${r.mensaje}. ${sigue}`.slice(0, 280),
      },
      'cobro-token-epayco',
    )
    return { tipo: 'rechazado', cobroId: cobroId as string, mensaje: r.mensaje }
  }
  await anotar('error', null, r.mensaje)
  return { tipo: 'error', mensaje: r.mensaje }
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
  if (!(deps.adapterPara ?? adapterPara)('epayco')) return resumen
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
        } else if (r.tipo === 'error') resumen.errores.push({ cuotaId: c.id, error: r.mensaje })
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
