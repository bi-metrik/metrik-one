import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { cuotasConEstado, type CuotaDeServicio } from '@/lib/valida-cda/pago-pendiente'
import type { ContextoSuscripcion } from './contexto-servidor'
import { parametroEntero, parametroMonto } from './contexto-servidor'
import {
  asignarCargosCompra,
  cargosALiberar,
  conceptoBase,
  conceptoConDesglose,
  diaInicioDeContrato,
  periodoDeCuota,
  sumaPorCuota,
  type Cargo,
  type CargoVivo,
  type CuotaDelPlan,
  type Periodo,
  type Prorrata,
} from './periodos'

/**
 * Las licencias del contrato y las dos escrituras de su cobro: comprar un usuario adicional y dejar
 * de pagarlo. La aritmética es de `periodos.ts` (pura, con pruebas); aquí se leen las cuotas y los
 * cobros REALES del plan con el cliente de servicio (el cliente no ve `planes_cobro` ni `cobros`), y
 * se llama a la función de la base que escribe todo en una transacción y vuelve a comprobar, con
 * las filas bloqueadas, que ninguna cuota tocada tenga un cobro.
 *
 * Ninguna función de aquí decide QUIÉN puede: la acción exige el contexto `ok` (dueño,
 * administrador o persona designada) antes de llamarlas.
 */

type Ctx = Extract<ContextoSuscripcion, { tipo: 'ok' }>

export interface EstadoLicencias {
  /** Las del contrato (`parametros.licencias`). `null` = el contrato no lo declara. */
  licencias: number | null
  /** El valor mensual de un usuario adicional (cláusula 2.3), del contrato. `null` = no declarado. */
  valorAdicional: number | null
  adicionalesVigentes: { id: string; fechaCompra: string; valorMensual: number }[]
}

export async function leerLicencias(ctx: Ctx): Promise<EstadoLicencias | 'error'> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const r = await svc
    .from('licencias_adicionales')
    .select('id, fecha_compra, valor_mensual')
    .eq('servicio_contratado_id', ctx.contrato.id)
    .is('fecha_retiro', null)
    .order('fecha_compra', { ascending: false })
  if (r.error) {
    console.error('[suscripcion] licencias adicionales:', r.error.message)
    return 'error'
  }
  return {
    licencias: parametroEntero(ctx.contrato.parametros, 'licencias'),
    valorAdicional: parametroMonto(ctx.contrato.parametros, 'valor_usuario_adicional'),
    adicionalesVigentes: ((r.data ?? []) as { id: string; fecha_compra: string; valor_mensual: number | string }[]).map((x) => ({
      id: x.id,
      fechaCompra: x.fecha_compra,
      valorMensual: Number(x.valor_mensual),
    })),
  }
}

interface FilaCuotaPlan {
  id: string
  plan_cobro_id: string
  numero: number
  tipo: string
  monto: number | string
  fecha_vencimiento: string
  concepto_detalle: string | null
}

interface FilaCobro {
  plan_cobro_id: string | null
  numero_cuota: number | null
  monto: number | string | null
  fecha: string | null
  anulado_at: string | null
}

interface FilaCargo {
  id: string
  licencia_id: string
  plan_cobro_cuota_id: string
  tipo: 'prorrata' | 'periodo'
  periodo_desde: string
  periodo_hasta: string
  dias: number
  dias_periodo: number
  monto: number | string
}

interface PlanLeido {
  cuotas: (CuotaDelPlan & { base: string | null })[]
  cargosVivos: (CargoVivo & { licenciaId: string })[]
}

/** Las cuotas del plan con lo que se puede tocar, y los cargos vivos de licencias sobre ellas. */
async function leerPlan(ctx: Ctx, hoy: string): Promise<PlanLeido | 'error'> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const planes = await svc
    .from('planes_cobro')
    .select('id')
    .eq('negocio_id', ctx.contrato.negocioId)
    .eq('workspace_id', ctx.contrato.cobradorId)
  if (planes.error) {
    console.error('[suscripcion] planes:', planes.error.message)
    return 'error'
  }
  const ids = ((planes.data ?? []) as { id: string }[]).map((p) => p.id)
  if (ids.length === 0) return { cuotas: [], cargosVivos: [] }

  const [cuotas, cobros] = await Promise.all([
    svc.from('plan_cobro_cuotas').select('id, plan_cobro_id, numero, tipo, monto, fecha_vencimiento, concepto_detalle').in('plan_cobro_id', ids),
    svc.from('cobros').select('plan_cobro_id, numero_cuota, monto, fecha, anulado_at').eq('negocio_id', ctx.contrato.negocioId),
  ])
  if (cuotas.error || cobros.error) {
    console.error('[suscripcion] cuotas o cobros:', cuotas.error?.message ?? cobros.error?.message)
    return 'error'
  }
  const filasCuota = (cuotas.data ?? []) as FilaCuotaPlan[]
  const filasCobro = (cobros.data ?? []) as FilaCobro[]

  const cargos = filasCuota.length
    ? await svc
        .from('licencias_adicionales_cargos')
        .select('id, licencia_id, plan_cobro_cuota_id, tipo, periodo_desde, periodo_hasta, dias, dias_periodo, monto')
        .in('plan_cobro_cuota_id', filasCuota.map((q) => q.id))
        .is('anulado_at', null)
    : { data: [], error: null }
  if (cargos.error) {
    console.error('[suscripcion] cargos:', cargos.error.message)
    return 'error'
  }

  // Una cuota con un cobro vivo atado (programado con su enlace, o pagado) no se toca.
  const conCobro = new Set(
    filasCobro.filter((c) => c.anulado_at === null && c.plan_cobro_id && c.numero_cuota !== null).map((c) => `${c.plan_cobro_id}#${c.numero_cuota}`),
  )
  // Y tampoco una que ya recibió plata por el reparto de lo pagado (un pago suelto del negocio).
  const estados = cuotasConEstado({
    cuotas: filasCuota.map(
      (q): CuotaDeServicio => ({
        cuotaId: q.id,
        numero: q.numero,
        tipo: q.tipo,
        monto: Number(q.monto),
        fechaVencimiento: q.fecha_vencimiento,
        concepto: q.concepto_detalle,
        enlacePagoUrl: null,
        enlacePagoExpira: null,
      }),
    ),
    cobros: filasCobro
      .filter((c) => c.anulado_at === null && c.fecha !== null)
      .map((c) => ({ monto: Number(c.monto ?? 0), estado: 'pagado' as const })),
    hoy,
    ahoraISO: new Date().toISOString(),
  })
  const sinPlata = new Set(estados.filter((e) => e.estado !== 'pagada' && e.abonado === 0).map((e) => e.cuotaId))

  return {
    cuotas: filasCuota.map((q) => ({
      id: q.id,
      numero: q.numero,
      monto: Number(q.monto),
      concepto: q.concepto_detalle,
      base: conceptoBase(q.concepto_detalle),
      fechaVencimiento: q.fecha_vencimiento,
      modificable: !conCobro.has(`${q.plan_cobro_id}#${q.numero}`) && sinPlata.has(q.id),
    })),
    cargosVivos: ((cargos.data ?? []) as FilaCargo[]).map((c) => ({
      id: c.id,
      licenciaId: c.licencia_id,
      cuotaId: c.plan_cobro_cuota_id,
      cuotaNumero: filasCuota.find((q) => q.id === c.plan_cobro_cuota_id)?.numero ?? 0,
      tipo: c.tipo,
      periodoDesde: c.periodo_desde,
      periodoHasta: c.periodo_hasta,
      dias: c.dias,
      diasPeriodo: c.dias_periodo,
      monto: Number(c.monto),
    })),
  }
}

export type Cotizacion =
  | {
      ok: true
      valorMensual: number
      prorrata: Prorrata
      /** La cuota donde se empieza a cobrar, con su periodo y cuánto sube. */
      primeraCuota: { numero: number; periodo: Periodo; sube: number }
      cargos: Cargo[]
    }
  | { ok: false; error: string }

const SIN_VALOR = 'El valor del usuario adicional no está registrado en tu contrato. Escríbenos y lo resolvemos.'

/** Lo que costaría un usuario adicional comprado hoy, y en qué cuota se cobra. No escribe nada. */
export async function cotizarLicencia(ctx: Ctx, hoy: string): Promise<Cotizacion> {
  const valor = parametroMonto(ctx.contrato.parametros, 'valor_usuario_adicional')
  if (valor === null) return { ok: false, error: SIN_VALOR }
  if (ctx.contrato.estado !== 'activo') return { ok: false, error: 'Tu contrato no está activo. Escríbenos.' }
  const plan = await leerPlan(ctx, hoy)
  if (plan === 'error') return { ok: false, error: 'No se pudo leer tu plan de pagos. Intenta de nuevo en un momento.' }

  const a = asignarCargosCompra({
    fecha: hoy,
    diaInicio: diaInicioDeContrato(ctx.contrato.vigenteDesde),
    valorMensual: valor,
    cuotas: plan.cuotas,
  })
  if (!a.ok) {
    return {
      ok: false,
      error: 'Tu plan de pagos no tiene una cuota próxima donde cobrar el usuario adicional. Escríbenos y lo agregamos.',
    }
  }
  const sube = sumaPorCuota(a.cargos).get(a.primeraCuota.id) ?? 0
  return {
    ok: true,
    valorMensual: valor,
    prorrata: a.prorrata,
    primeraCuota: { numero: a.primeraCuota.numero, periodo: a.primeraCuota.periodo, sube },
    cargos: a.cargos,
  }
}

function cuotasNuevas(
  plan: PlanLeido,
  cambios: Map<string, number>,
  cargosResultantes: (cuotaId: string) => Omit<Cargo, 'cuotaId' | 'cuotaNumero'>[],
) {
  return [...cambios.entries()].map(([cuotaId, delta]) => {
    const q = plan.cuotas.find((x) => x.id === cuotaId)
    if (!q) throw new Error(`cuota ${cuotaId} fuera del plan`)
    return {
      cuota_id: cuotaId,
      monto_antes: q.monto,
      monto_nuevo: q.monto + delta,
      concepto_nuevo: conceptoConDesglose(q.base, cargosResultantes(cuotaId)) ?? `Cuota ${q.numero}`,
    }
  })
}

/** Traduce el error de la función de la base a algo que se le puede decir a la persona. */
function mensajeDeBase(msg: string): string {
  if (/licencias_cambiaron/.test(msg)) return 'Las licencias de tu contrato acaban de cambiar. Recarga la página y revisa antes de seguir.'
  if (/cuota_con_cobro|cuota_cambio/.test(msg)) return 'Tu plan de pagos acaba de cambiar. Recarga la página y vuelve a intentarlo.'
  if (/valor_distinto/.test(msg)) return 'El valor del usuario adicional de tu contrato cambió. Recarga la página.'
  if (/licencia_ya_retirada/.test(msg)) return 'Esa licencia ya se había dejado de pagar.'
  return 'No se pudo registrar el cambio. Intenta de nuevo en un momento.'
}

export async function comprarLicencia(
  ctx: Ctx,
  hoy: string,
  licenciasAntes: number,
): Promise<{ ok: true; licenciaId: string; cotizacion: Extract<Cotizacion, { ok: true }> } | { ok: false; error: string }> {
  const cot = await cotizarLicencia(ctx, hoy)
  if (!cot.ok) return cot
  const plan = await leerPlan(ctx, hoy)
  if (plan === 'error') return { ok: false, error: 'No se pudo leer tu plan de pagos. Intenta de nuevo en un momento.' }

  const delta = sumaPorCuota(cot.cargos)
  const cuotas = cuotasNuevas(plan, delta, (cuotaId) => [
    ...plan.cargosVivos.filter((c) => c.cuotaId === cuotaId),
    ...cot.cargos.filter((c) => c.cuotaId === cuotaId),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (createServiceClient() as any).rpc('registrar_compra_licencia', {
    p_servicio_contratado_id: ctx.contrato.id,
    p_registrado_por: ctx.usuarioId,
    p_fecha: hoy,
    p_valor: cot.valorMensual,
    p_licencias_antes: licenciasAntes,
    p_cargos: cot.cargos.map((c) => ({
      cuota_id: c.cuotaId,
      tipo: c.tipo,
      periodo_desde: c.periodoDesde,
      periodo_hasta: c.periodoHasta,
      dias: c.dias,
      dias_periodo: c.diasPeriodo,
      monto: c.monto,
    })),
    p_cuotas: cuotas,
    p_motivo:
      'Solicitud expresa de un usuario adicional según la cláusula 2.3 de los Términos, confirmada en la sección Suscripción ' +
      `por la persona de la sesión. Prorrata de ${cot.prorrata.dias} de ${cot.prorrata.periodo.dias} días y ${cot.valorMensual} por periodo siguiente.`,
  })
  if (r.error) {
    console.error('[suscripcion] registrar_compra_licencia:', r.error.message)
    return { ok: false, error: mensajeDeBase(r.error.message) }
  }
  return { ok: true, licenciaId: r.data as string, cotizacion: cot }
}

/**
 * Deja de pagar la licencia adicional más reciente desde el periodo siguiente. Devuelve desde qué
 * cuota deja de cobrarse (o `null` si todas las que la cobraban ya tenían cobro).
 */
export async function liberarLicencia(
  ctx: Ctx,
  hoy: string,
  licenciasAntes: number,
): Promise<{ ok: true; desdeCuota: number | null } | { ok: false; error: string }> {
  const estado = await leerLicencias(ctx)
  if (estado === 'error') return { ok: false, error: 'No se pudieron leer tus licencias. Intenta de nuevo.' }
  const licencia = estado.adicionalesVigentes[0]
  if (!licencia) return { ok: false, error: 'No tienes licencias adicionales para dejar de pagar.' }
  const plan = await leerPlan(ctx, hoy)
  if (plan === 'error') return { ok: false, error: 'No se pudo leer tu plan de pagos. Intenta de nuevo en un momento.' }

  const propios = plan.cargosVivos.filter((c) => c.licenciaId === licencia.id)
  const { anular } = cargosALiberar({
    fecha: hoy,
    diaInicio: diaInicioDeContrato(ctx.contrato.vigenteDesde),
    cargos: propios,
    cuotasModificables: new Set(plan.cuotas.filter((q) => q.modificable).map((q) => q.id)),
  })
  const idsAnular = new Set(anular.map((c) => c.id))
  const baja = new Map([...sumaPorCuota(anular).entries()].map(([k, v]) => [k, -v]))
  const cuotas = cuotasNuevas(plan, baja, (cuotaId) =>
    plan.cargosVivos.filter((c) => c.cuotaId === cuotaId && !idsAnular.has(c.id)),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (createServiceClient() as any).rpc('registrar_retiro_licencia', {
    p_licencia_id: licencia.id,
    p_registrado_por: ctx.usuarioId,
    p_fecha: hoy,
    p_cargos_anular: [...idsAnular],
    p_cuotas: cuotas,
    p_licencias_antes: licenciasAntes,
    p_motivo: 'Retiro de un usuario adicional desde la sección Suscripción: deja de cobrarse desde el periodo siguiente.',
  })
  if (r.error) {
    console.error('[suscripcion] registrar_retiro_licencia:', r.error.message)
    return { ok: false, error: mensajeDeBase(r.error.message) }
  }
  const primera = [...anular].sort((a, b) => a.periodoDesde.localeCompare(b.periodoDesde))[0]
  return { ok: true, desdeCuota: primera?.cuotaNumero ?? null }
}

/** El periodo de una cuota del plan, para decirlo en pantalla. */
export function periodoDeCuotaDelContrato(ctx: Ctx, cuota: { concepto: string | null; fechaVencimiento: string }): Periodo {
  return periodoDeCuota(cuota, diaInicioDeContrato(ctx.contrato.vigenteDesde))
}
