import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cuotasConEstado, type CobroRecibido, type CuotaDeServicio } from './pago-pendiente'
import { planDeActivacion, TIPO_CUOTA_ANUAL, type CuotaParaActivar } from './plan-anual'

/**
 * La activación del Plan Anual al aprobarse su pago: la corre el webhook de la pasarela
 * (`pago-en-linea-servidor.ts`, `trasPagoRegistrado`) con el cliente de servicio. La aritmética es de
 * `planDeActivacion` (pura); la escritura, de la función `activar_plan_anual_cda`, que vuelve a
 * comprobar todo con las filas bloqueadas.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

interface FilaPlanAnual {
  id: string
  estado: 'elegido' | 'activo' | 'sin_efecto' | 'requiere_revision'
  periodo_desde: string
  periodo_hasta: string
  cobro_id: string | null
  negocio_id: string
  plan_cobro_id: string
  workspace_id: string
  servicio_contratado_id: string
}

const COLUMNAS_PLAN = 'id, estado, periodo_desde, periodo_hasta, cobro_id, negocio_id, plan_cobro_id, workspace_id, servicio_contratado_id'

export type ResultadoActivacion =
  /** El cobro no es de un plan anual: nada que hacer. */
  | { tipo: 'no_aplica' }
  | { tipo: 'activado' | 'ya_activo'; planAnualId: string }
  /** No se activó: una persona revisa y devuelve la plata si corresponde (anexo 2.2). */
  | { tipo: 'requiere_revision'; planAnualId: string; detalle: string }

interface FilaCuota {
  id: string
  numero: number
  tipo: string
  monto: number | string
  fecha_vencimiento: string
  concepto_detalle: string | null
}

interface FilaCobroPlan {
  id: string
  monto: number | string | null
  retencion_iva: number | string | null
  fecha: string | null
  anulado_at: string | null
  plan_cobro_id: string | null
  numero_cuota: number | null
}

/**
 * Lo que hace el webhook después de registrar un pago aprobado. Idempotente: un reintento sobre un plan
 * ya activo responde `ya_activo`. Un error de base se lanza (el webhook responde 500 y la pasarela
 * reintenta); una regla que no se cumple deja la elección en `requiere_revision` con su detalle.
 */
export async function activarPlanAnualSiCorresponde(dbCliente: SupabaseClient, cobroId: string): Promise<ResultadoActivacion> {
  const db = dbCliente as Db
  const pa = await db.from('planes_anuales_cda').select(COLUMNAS_PLAN).eq('cobro_id', cobroId).maybeSingle()
  if (pa.error) throw new Error(`leer el plan anual del cobro ${cobroId}: ${pa.error.message}`)
  if (!pa.data) return { tipo: 'no_aplica' }
  const plan = pa.data as FilaPlanAnual
  if (plan.estado === 'activo') return { tipo: 'ya_activo', planAnualId: plan.id }

  const revisar = async (detalle: string): Promise<ResultadoActivacion> => {
    if (plan.estado === 'elegido') {
      const u = await db.from('planes_anuales_cda').update({ estado: 'requiere_revision', detalle }).eq('id', plan.id).eq('estado', 'elegido')
      if (u.error) throw new Error(`marcar el plan anual ${plan.id} para revisión: ${u.error.message}`)
    }
    return { tipo: 'requiere_revision', planAnualId: plan.id, detalle }
  }
  if (plan.estado !== 'elegido') return revisar(`Entró el pago de una elección del plan anual en estado ${plan.estado}.`)

  const [sc, cobroR, cuotasR, cobrosR] = await Promise.all([
    db.from('servicios_contratados').select('vigente_desde').eq('id', plan.servicio_contratado_id).maybeSingle(),
    db.from('cobros').select('id, fecha, anulado_at').eq('id', cobroId).maybeSingle(),
    db.from('plan_cobro_cuotas').select('id, numero, tipo, monto, fecha_vencimiento, concepto_detalle').eq('plan_cobro_id', plan.plan_cobro_id),
    db
      .from('cobros')
      .select('id, monto, retencion_iva, fecha, anulado_at, plan_cobro_id, numero_cuota')
      .eq('negocio_id', plan.negocio_id)
      .eq('workspace_id', plan.workspace_id),
  ])
  for (const r of [sc, cobroR, cuotasR, cobrosR]) {
    if (r.error) throw new Error(`leer el contrato del plan anual ${plan.id}: ${r.error.message}`)
  }
  if (!sc.data || !cobroR.data?.fecha || cobroR.data.anulado_at) return revisar('El cobro del plan anual no aparece pagado.')
  const fechaPago = cobroR.data.fecha as string

  const filasCuota = (cuotasR.data ?? []) as FilaCuota[]
  const filasCobro = (cobrosR.data ?? []) as FilaCobroPlan[]
  if (filasCuota.some((q) => q.tipo === TIPO_CUOTA_ANUAL)) {
    // Una cuota anual que ya existe en el plan es de otro plan anual: no se superpone otra.
    const otro = filasCuota.find((q) => q.tipo === TIPO_CUOTA_ANUAL)
    return revisar(`El plan de cobro ya tiene una cuota anual (cuota ${otro?.numero}).`)
  }

  // El reparto SIN el pago del anual: lo que había antes de pagarlo.
  const sinAnual: CobroRecibido[] = filasCobro
    .filter((c) => c.id !== cobroId)
    .map((c) => ({
      monto: Number(c.monto ?? 0),
      retencionIva: Number(c.retencion_iva ?? 0),
      estado: c.anulado_at ? 'anulado' : c.fecha === null ? 'programado' : 'pagado',
    }))
  const cuotasFifo: CuotaDeServicio[] = filasCuota.map((q) => ({
    cuotaId: q.id,
    numero: q.numero,
    tipo: q.tipo,
    monto: Number(q.monto),
    fechaVencimiento: q.fecha_vencimiento,
    concepto: q.concepto_detalle,
    enlacePagoUrl: null,
    enlacePagoExpira: null,
  }))
  const estados = cuotasConEstado({ cuotas: cuotasFifo, cobros: sinAnual, hoy: fechaPago, ahoraISO: new Date().toISOString() })
  const porId = new Map(estados.map((e) => [e.cuotaId, e]))

  const ids = filasCuota.map((q) => q.id)
  const cargosR = ids.length
    ? await db
        .from('licencias_adicionales_cargos')
        .select('plan_cobro_cuota_id, tipo, periodo_desde, periodo_hasta, dias, dias_periodo, monto')
        .in('plan_cobro_cuota_id', ids)
        .is('anulado_at', null)
    : { data: [], error: null }
  if (cargosR.error) throw new Error(`leer los cargos de licencias del plan anual ${plan.id}: ${cargosR.error.message}`)
  const cargos = (cargosR.data ?? []) as {
    plan_cobro_cuota_id: string
    tipo: 'prorrata' | 'periodo'
    periodo_desde: string
    periodo_hasta: string
    dias: number
    dias_periodo: number
    monto: number | string
  }[]

  const cuotas: CuotaParaActivar[] = filasCuota.map((q) => {
    const cobroVivo = filasCobro.find(
      (c) => c.plan_cobro_id === plan.plan_cobro_id && c.numero_cuota === q.numero && c.anulado_at === null && c.id !== cobroId,
    )
    const e = porId.get(q.id)
    return {
      id: q.id,
      numero: q.numero,
      tipo: q.tipo,
      monto: Number(q.monto),
      fechaVencimiento: q.fecha_vencimiento,
      concepto: q.concepto_detalle,
      cobroVivo: cobroVivo ? { id: cobroVivo.id, pagado: cobroVivo.fecha !== null } : null,
      conPlata: Boolean(e && e.abonado > 0),
      cargos: cargos
        .filter((c) => c.plan_cobro_cuota_id === q.id)
        .map((c) => ({
          tipo: c.tipo,
          periodoDesde: c.periodo_desde,
          periodoHasta: c.periodo_hasta,
          dias: c.dias,
          diasPeriodo: c.dias_periodo,
          monto: Number(c.monto),
        })),
    }
  })

  const plan2 = planDeActivacion({
    plazo: { desde: plan.periodo_desde, hasta: plan.periodo_hasta },
    vigenteDesde: sc.data.vigente_desde as string,
    fechaPago,
    cuotas,
    hayCuotasVencidas: estados.some((e) => e.estado === 'vencida'),
  })
  if (!plan2.ok) return revisar(plan2.motivo)

  const rpc = await db.rpc('activar_plan_anual_cda', {
    p_plan_anual_id: plan.id,
    p_cobro_id: cobroId,
    p_cambios: {
      actualizar: plan2.actualizar.map((c) => ({
        id: c.id,
        monto_esperado: c.montoEsperado,
        tipo_esperado: c.tipoEsperado,
        monto: c.monto,
        concepto: c.concepto,
      })),
      insertar: plan2.insertar.map((c) => ({ numero: c.numero, tipo: c.tipo, monto: c.monto, fecha_vencimiento: c.fechaVencimiento, concepto: c.concepto })),
      anular_cobros: plan2.anularCobros,
      cuota_anual: {
        numero: plan2.cuotaAnual.numero,
        tipo: plan2.cuotaAnual.tipo,
        monto: plan2.cuotaAnual.monto,
        fecha_vencimiento: plan2.cuotaAnual.fechaVencimiento,
        concepto: plan2.cuotaAnual.concepto,
      },
    },
  })
  if (rpc.error) {
    // Una carrera (alguien tocó una cuota en el medio) o un dato que la base no acepta: a revisión,
    // con el mensaje. Lo demás es un error de base y se reintenta.
    const msg = String(rpc.error.message ?? '')
    if (/cuota_cambio|cuota_con_cobro|activar_plan_anual_cda:/.test(msg)) return revisar(`La base no activó el plan: ${msg}`)
    throw new Error(`activar el plan anual ${plan.id}: ${msg}`)
  }
  return { tipo: rpc.data === 'ya_activo' ? 'ya_activo' : 'activado', planAnualId: plan.id }
}
