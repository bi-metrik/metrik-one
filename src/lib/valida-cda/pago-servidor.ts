import 'server-only'
import { cache } from 'react'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { esFuncionAusente } from '@/lib/valida-api/mapeo'
import {
  cuotasConEstado,
  proximoPago,
  type CobroRecibido,
  type CuotaConEstado,
  type CuotaDeServicio,
  type ProximoPago,
  ultimoPagoDeCadaCuota,
} from './pago-pendiente'
import { carteraDe, separarPorEpoca, type MarcaDeCobro, type MarcaDeCuota } from './cancelada'
import { documentosDelCliente } from '@/lib/valida-api/terminos-servidor'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { separarNoVendidas, VENTA_SIN_V15, ventaDeDocumentos, type VentaV15 } from './venta-16-4'

/**
 * Las cuotas y los pagos del contrato de un CDA, leídos SOLO por las RPC cerradas del cobrador:
 * `mis_cuotas_de_servicio` (20260924010000) y `mis_cobros_de_servicio` (C2). Las dos filtran por
 * `current_user_workspace_id()` y solo responden al espacio que PAGA el contrato, así que se llaman
 * con el cliente de SESIÓN: con el de servicio no tienen de qué espacio leer y devuelven nada.
 *
 * Una sola lectura por request (`cache`) alimenta la tarjeta del próximo pago, la regla de mora
 * (`plazos.ts`) y la pestaña Pagos: tres respuestas distintas sobre dos lecturas distintas se
 * contradirían en la misma pantalla.
 *
 * Nunca un `?? []` sobre un error: «no pude leer las cuotas» no es «no debes nada».
 *
 * ## El plan vigente y la cartera (PR B, 2026-11-04)
 *
 * Lo que devuelve `cuotas` y `cobros` es el PLAN VIGENTE (`separarPorEpoca`): sin las cuotas anuladas por
 * la 2.5 y, después de una reactivación (11.4), solo lo del plan nuevo. La mora, la tarjeta de pago, la
 * 16.4 y la pestaña Pagos leen eso, así que el pago de la reactivación nunca tapa una cuota vieja. Lo de
 * antes de la reactivación va en `anterior`, de donde sale la cartera (11.7). Sin las columnas nuevas de
 * las RPC (antes de la migración 20261104233000) todo es vigente, como siempre.
 *
 * ## Los períodos no vendidos (16.4, Emilio 5-nov)
 *
 * Del plan vigente salen también las cuotas de períodos que METRIK no vende sin la v1.5 aceptada
 * (`venta-16-4.ts`, `separarNoVendidas`): no son mora, ni pago pendiente, ni deuda en Pagos. Van en
 * `noVendidas`. La venta sale de los documentos de la sesión (`documentosDelCliente`); sin poder leerlos no
 * se saca nada (como antes de esta regla).
 */

interface FilaCuota {
  cuota_id: string | null
  numero: number
  tipo: string
  monto: number | string
  fecha_vencimiento: string
  concepto: string | null
  enlace_pago_url: string | null
  enlace_pago_expira: string | null
  factura_numero: string | null
  factura_pdf_path: string | null
  factura_xml_path: string | null
  /** 20261104233000: la cuota no se cobra (2.5), el inicio de su plan y la reactivación del contrato. */
  anulada?: boolean | null
  plan_fecha_inicio?: string | null
  reactivada_desde?: string | null
}

interface FilaCobro {
  cobro_id: string
  fecha: string | null
  monto: number | string | null
  fuente: string | null
  estado: string
  recibo_numero: string | null
  recibo_path: string | null
  /** La retención de IVA que el cliente practicó (20260924100000). Ausente antes de esa migración. */
  retencion_iva?: number | string | null
  /** 20261104233000: el inicio del plan del cobro, si es el pago de la reactivación sin plan y la reactivación. */
  plan_fecha_inicio?: string | null
  es_reactivacion?: boolean | null
  reactivada_desde?: string | null
}

/** Un pago recibido del contrato, para la pestaña Pagos. */
export interface PagoRecibidoCda {
  cobroId: string
  fecha: string | null
  monto: number
  fuente: string | null
  estado: 'pagado' | 'programado' | 'anulado'
  reciboNumero: string | null
  reciboDescargable: boolean
  /** La retención de IVA del pago: también cubre la cuota (ver `CobroRecibido.retencionIva`). */
  retencionIva?: number
}

export type LecturaCuenta =
  | {
      estado: 'ok'
      /** Las cuotas del plan vigente, sin las anuladas (2.5). */
      cuotas: CuotaDeServicio[]
      /** Lo recibido que cubre el plan vigente. */
      cobros: CobroRecibido[]
      /** Todos los pagos del contrato, para la lista de la pestaña Pagos. */
      pagos: PagoRecibidoCda[]
      /** Los pagos que cubren el plan vigente (el mismo corte de `cobros`), para decir qué pago cubrió cada cuota. */
      pagosVigentes?: PagoRecibidoCda[]
      /** Lo anterior a la reactivación (11.4): la cartera sale de aquí. Vacío sin reactivación. */
      anterior?: { cuotas: CuotaDeServicio[]; cobros: CobroRecibido[] }
      /** El día de la reactivación del contrato, o `null`. */
      reactivadaDesde?: string | null
      /** La base de la 16.4 y el día de la aceptación de la v1.5 (`VENTA_SIN_V15` sin v1.5 o sin poder leerla). */
      venta?: VentaV15
      /** Las cuotas del plan vigente que no se venden (16.4): fuera de `cuotas`. */
      noVendidas?: CuotaDeServicio[]
    }
  | { estado: 'no_disponible'; motivo: 'base' | 'sin_migracion' }

export type LecturaPago =
  | { estado: 'ok'; pago: ProximoPago }
  | { estado: 'no_disponible'; motivo: 'base' | 'sin_migracion' }

export type LecturaPestanaPagos =
  | {
      estado: 'ok'
      cuotas: CuotaConEstado[]
      pagos: PagoRecibidoCda[]
      /** Cuotas con saldo de períodos que empiezan antes de la v1.5 (11.7), fuera del plan vigente. */
      cartera?: CuotaConEstado[]
    }
  | { estado: 'no_disponible'; motivo: 'base' | 'sin_migracion' }

function estadoCobro(estado: string): 'pagado' | 'programado' | 'anulado' {
  return estado === 'anulado' ? 'anulado' : estado === 'programado' ? 'programado' : 'pagado'
}

async function leerCuenta(servicioContratadoId: string): Promise<LecturaCuenta> {
  const { supabase } = await getWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cliente = supabase as any
  const [cuotas, cobros] = await Promise.all([
    cliente.rpc('mis_cuotas_de_servicio', { p_servicio_contratado_id: servicioContratadoId }),
    cliente.rpc('mis_cobros_de_servicio', { p_servicio_contratado_id: servicioContratadoId }),
  ])
  for (const r of [cuotas, cobros]) {
    if (r.error) {
      if (esFuncionAusente(r.error)) return { estado: 'no_disponible', motivo: 'sin_migracion' }
      console.error('[valida-cda] cuotas o cobros del contrato:', r.error.message)
      return { estado: 'no_disponible', motivo: 'base' }
    }
  }

  const filasCuota = (cuotas.data ?? []) as FilaCuota[]
  const filasCobro = (cobros.data ?? []) as FilaCobro[]
  const pagos = filasCobro.map(
    (c): PagoRecibidoCda & MarcaDeCobro => ({
      cobroId: c.cobro_id,
      fecha: c.fecha,
      monto: Number(c.monto ?? 0),
      fuente: c.fuente,
      estado: estadoCobro(c.estado),
      reciboNumero: c.recibo_numero,
      reciboDescargable: Boolean(c.recibo_path),
      retencionIva: Number(c.retencion_iva ?? 0),
      planFechaInicio: c.plan_fecha_inicio ?? null,
      esReactivacion: c.es_reactivacion === true,
    }),
  )
  const reactivadaDesde =
    filasCuota.find((c) => c.reactivada_desde)?.reactivada_desde ?? filasCobro.find((c) => c.reactivada_desde)?.reactivada_desde ?? null
  const epocas = separarPorEpoca<CuotaDeServicio & MarcaDeCuota, CobroRecibido & MarcaDeCobro>({
    cuotas: filasCuota.map((c) => ({
      cuotaId: c.cuota_id ?? null,
      numero: c.numero,
      tipo: c.tipo,
      monto: Number(c.monto),
      fechaVencimiento: c.fecha_vencimiento,
      concepto: c.concepto,
      enlacePagoUrl: c.enlace_pago_url,
      enlacePagoExpira: c.enlace_pago_expira,
      factura:
        c.factura_numero && (c.factura_pdf_path || c.factura_xml_path)
          ? { numero: c.factura_numero, pdf: Boolean(c.factura_pdf_path), xml: Boolean(c.factura_xml_path) }
          : null,
      anulada: c.anulada === true,
      planFechaInicio: c.plan_fecha_inicio ?? null,
    })),
    cobros: filasCobro.map((c) => ({
      monto: Number(c.monto ?? 0),
      estado: estadoCobro(c.estado),
      retencionIva: Number(c.retencion_iva ?? 0),
      planFechaInicio: c.plan_fecha_inicio ?? null,
      esReactivacion: c.es_reactivacion === true,
    })),
    reactivadaDesde,
  })
  // 16.4: los períodos que METRIK no vende sin la v1.5 aceptada salen del plan vigente.
  const docs = await documentosDelCliente()
  const venta = docs.ok ? ventaDeDocumentos(docs.documentos) : VENTA_SIN_V15
  const estados = cuotasConEstado({
    cuotas: epocas.vigente.cuotas,
    cobros: epocas.vigente.cobros,
    hoy: todayBogotaISO(),
    ahoraISO: new Date().toISOString(),
  })
  const { vendidas, noVendidas } = separarNoVendidas(epocas.vigente.cuotas, estados, venta)
  return {
    estado: 'ok',
    cuotas: vendidas,
    noVendidas,
    venta,
    cobros: epocas.vigente.cobros,
    anterior: epocas.anterior,
    reactivadaDesde,
    pagos,
    pagosVigentes: separarPorEpoca({ cuotas: [], cobros: pagos, reactivadaDesde }).vigente.cobros,
  }
}

/** Una sola lectura por request aunque la pidan la puerta, la tarjeta y la pestaña. */
export const leerCuentaCda = cache(leerCuenta)

export async function leerProximoPagoCda(
  servicioContratadoId: string,
  hoy: string,
  ahoraISO: string = new Date().toISOString(),
  /** Tipos de cuota que no son «la pendiente» (la mora del servicio ignora los usuarios adicionales). */
  ignorarTipos?: readonly string[],
): Promise<LecturaPago> {
  const cuenta = await leerCuentaCda(servicioContratadoId)
  if (cuenta.estado !== 'ok') return cuenta
  return { estado: 'ok', pago: proximoPago({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy, ahoraISO, ignorarTipos }) }
}

export async function leerPestanaPagosCda(
  servicioContratadoId: string,
  hoy: string,
  ahoraISO: string = new Date().toISOString(),
  /**
   * La vigencia de la v1.5 (`transicionDesde`) y si la suscripción está Cancelada. Con la Cancelada, las
   * cuotas de la transición sin pagar salen de la lista y van a la cartera (11.7).
   */
  opciones: { transicion?: string | null; cancelada?: boolean } = {},
): Promise<LecturaPestanaPagos> {
  const cuenta = await leerCuentaCda(servicioContratadoId)
  if (cuenta.estado !== 'ok') return cuenta
  const todas = cuotasConEstado({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy, ahoraISO })
  // La fecha y el medio del pago que cubrió cada cuota, por el mismo reparto que le dio su estado.
  const ultimos = ultimoPagoDeCadaCuota(todas, cuenta.pagosVigentes ?? cuenta.pagos)
  const conPago = todas.map((c, i) => ({ ...c, ultimoPago: c.abonado > 0 ? ultimos[i] : null }))
  const transicion = opciones.transicion ?? null
  // La cartera (11.7): lo anterior a la reactivación con saldo y, con la suscripción Cancelada, lo de la
  // transición del plan vigente. Sin la v1.5 no hay transición: es cartera todo lo anterior con saldo.
  const anteriores = cuotasConEstado({ cuotas: cuenta.anterior?.cuotas ?? [], cobros: cuenta.anterior?.cobros ?? [], hoy, ahoraISO })
  const carteraAnterior = transicion ? carteraDe(anteriores, transicion) : anteriores.filter((c) => c.saldo > 0)
  const carteraVigente = opciones.cancelada && transicion ? carteraDe(conPago, transicion) : []
  const enCartera = new Set(carteraVigente)
  return {
    estado: 'ok',
    cuotas: conPago.filter((c) => !enCartera.has(c)),
    cartera: [...carteraAnterior, ...carteraVigente],
    // Lo que entró, del más reciente al más viejo (el orden de la RPC). Los programados no son
    // plata todavía: su lugar es la cuota, con su enlace.
    pagos: cuenta.pagos.filter((p) => p.estado !== 'programado'),
  }
}
