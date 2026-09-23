import 'server-only'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { esFuncionAusente } from '@/lib/valida-api/mapeo'
import { proximoPago, type CobroRecibido, type CuotaDeServicio, type ProximoPago } from './pago-pendiente'

/**
 * Las cuotas y los pagos del contrato de un CDA, leídos SOLO por las RPC cerradas del cobrador:
 * `mis_cuotas_de_servicio` (20260923220000) y `mis_cobros_de_servicio` (C2). Las dos filtran por
 * `current_user_workspace_id()` y solo responden al espacio que PAGA el contrato, así que se llaman
 * con el cliente de SESIÓN: con el de servicio no tienen de qué espacio leer y devuelven nada.
 *
 * Nunca un `?? []` sobre un error: «no pude leer las cuotas» no es «no debes nada».
 */

interface FilaCuota {
  numero: number
  tipo: string
  monto: number | string
  fecha_vencimiento: string
  concepto: string | null
  enlace_pago_url: string | null
  enlace_pago_expira: string | null
}

interface FilaCobro {
  monto: number | string | null
  estado: string
}

export type LecturaPago =
  | { estado: 'ok'; pago: ProximoPago }
  | { estado: 'no_disponible'; motivo: 'base' | 'sin_migracion' }

export async function leerProximoPagoCda(
  servicioContratadoId: string,
  hoy: string,
  ahoraISO: string = new Date().toISOString(),
): Promise<LecturaPago> {
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
    pago: proximoPago({
      cuotas: filasCuota.map(
        (c): CuotaDeServicio => ({
          numero: c.numero,
          tipo: c.tipo,
          monto: Number(c.monto),
          fechaVencimiento: c.fecha_vencimiento,
          concepto: c.concepto,
          enlacePagoUrl: c.enlace_pago_url,
          enlacePagoExpira: c.enlace_pago_expira,
        }),
      ),
      cobros: filasCobro.map(
        (c): CobroRecibido => ({
          monto: Number(c.monto ?? 0),
          estado: c.estado === 'anulado' ? 'anulado' : c.estado === 'programado' ? 'programado' : 'pagado',
        }),
      ),
      hoy,
      ahoraISO,
    }),
  }
}
