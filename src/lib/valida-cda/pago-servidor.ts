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
} from './pago-pendiente'

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
}

interface FilaCobro {
  cobro_id: string
  fecha: string | null
  monto: number | string | null
  fuente: string | null
  estado: string
  recibo_numero: string | null
  recibo_path: string | null
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
}

export type LecturaCuenta =
  | {
      estado: 'ok'
      cuotas: CuotaDeServicio[]
      cobros: CobroRecibido[]
      pagos: PagoRecibidoCda[]
    }
  | { estado: 'no_disponible'; motivo: 'base' | 'sin_migracion' }

export type LecturaPago =
  | { estado: 'ok'; pago: ProximoPago }
  | { estado: 'no_disponible'; motivo: 'base' | 'sin_migracion' }

export type LecturaPestanaPagos =
  | { estado: 'ok'; cuotas: CuotaConEstado[]; pagos: PagoRecibidoCda[] }
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
  return {
    estado: 'ok',
    cuotas: filasCuota.map(
      (c): CuotaDeServicio => ({
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
      }),
    ),
    cobros: filasCobro.map((c): CobroRecibido => ({ monto: Number(c.monto ?? 0), estado: estadoCobro(c.estado) })),
    pagos: filasCobro.map(
      (c): PagoRecibidoCda => ({
        cobroId: c.cobro_id,
        fecha: c.fecha,
        monto: Number(c.monto ?? 0),
        fuente: c.fuente,
        estado: estadoCobro(c.estado),
        reciboNumero: c.recibo_numero,
        reciboDescargable: Boolean(c.recibo_path),
      }),
    ),
  }
}

/** Una sola lectura por request aunque la pidan la puerta, la tarjeta y la pestaña. */
export const leerCuentaCda = cache(leerCuenta)

export async function leerProximoPagoCda(
  servicioContratadoId: string,
  hoy: string,
  ahoraISO: string = new Date().toISOString(),
): Promise<LecturaPago> {
  const cuenta = await leerCuentaCda(servicioContratadoId)
  if (cuenta.estado !== 'ok') return cuenta
  return { estado: 'ok', pago: proximoPago({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy, ahoraISO }) }
}

export async function leerPestanaPagosCda(
  servicioContratadoId: string,
  hoy: string,
  ahoraISO: string = new Date().toISOString(),
): Promise<LecturaPestanaPagos> {
  const cuenta = await leerCuentaCda(servicioContratadoId)
  if (cuenta.estado !== 'ok') return cuenta
  return {
    estado: 'ok',
    cuotas: cuotasConEstado({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy, ahoraISO }),
    // Lo que entró, del más reciente al más viejo (el orden de la RPC). Los programados no son
    // plata todavía: su lugar es la cuota, con su enlace.
    pagos: cuenta.pagos.filter((p) => p.estado !== 'programado'),
  }
}
