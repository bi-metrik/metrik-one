import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Del lado del cobrador (metrik): las cuotas de un negocio que es un contrato de servicio, con la
 * factura electrónica que ya se cargó a cada una. Alimenta el bloque de carga de facturas en la ficha
 * del negocio.
 *
 * Solo aplica a un negocio con un contrato en `servicios_contratados` cuyo cobrador es el espacio de
 * la sesión: fuera de eso no hay a quién mostrarle la factura, y el bloque no se pinta. Se lee con
 * el cliente de servicio porque `facturas_cuota` es server-only, así que el filtro por espacio va
 * escrito en cada consulta.
 */

export interface CuotaConFactura {
  cuotaId: string
  numero: number
  concepto: string | null
  monto: number
  fechaVencimiento: string
  factura: { numero: string; pdf: boolean; xml: boolean; cargadaAt: string } | null
}

export type LecturaFacturasNegocio =
  | { estado: 'no_aplica' }
  | { estado: 'no_disponible' }
  | { estado: 'ok'; cuotas: CuotaConFactura[] }

export async function leerFacturasDeCuotas(workspaceId: string, negocioId: string): Promise<LecturaFacturasNegocio> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const contrato = await svc
    .from('servicios_contratados')
    .select('id')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', workspaceId)
    .limit(1)
  if (contrato.error) {
    console.error('[facturas-cuota] contrato del negocio:', contrato.error.message)
    return { estado: 'no_disponible' }
  }
  if ((contrato.data ?? []).length === 0) return { estado: 'no_aplica' }

  const planes = await svc.from('planes_cobro').select('id').eq('negocio_id', negocioId).eq('workspace_id', workspaceId)
  if (planes.error) {
    console.error('[facturas-cuota] planes del negocio:', planes.error.message)
    return { estado: 'no_disponible' }
  }
  const idsPlan = ((planes.data ?? []) as { id: string }[]).map((p) => p.id)
  if (idsPlan.length === 0) return { estado: 'ok', cuotas: [] }

  const cuotas = await svc
    .from('plan_cobro_cuotas')
    .select('id, numero, monto, fecha_vencimiento, concepto_detalle')
    .in('plan_cobro_id', idsPlan)
    .eq('workspace_id', workspaceId)
    .order('fecha_vencimiento', { ascending: true })
    .order('numero', { ascending: true })
  if (cuotas.error) {
    console.error('[facturas-cuota] cuotas del negocio:', cuotas.error.message)
    return { estado: 'no_disponible' }
  }
  const filas = (cuotas.data ?? []) as {
    id: string
    numero: number
    monto: number | string
    fecha_vencimiento: string
    concepto_detalle: string | null
  }[]
  if (filas.length === 0) return { estado: 'ok', cuotas: [] }

  const facturas = await svc
    .from('facturas_cuota')
    .select('plan_cobro_cuota_id, numero, pdf_path, xml_path, updated_at')
    .in(
      'plan_cobro_cuota_id',
      filas.map((f) => f.id),
    )
    .eq('workspace_id', workspaceId)
  if (facturas.error) {
    console.error('[facturas-cuota] facturas:', facturas.error.message)
    return { estado: 'no_disponible' }
  }
  const porCuota = new Map<string, { numero: string; pdf_path: string | null; xml_path: string | null; updated_at: string }>()
  for (const f of (facturas.data ?? []) as {
    plan_cobro_cuota_id: string
    numero: string
    pdf_path: string | null
    xml_path: string | null
    updated_at: string
  }[]) {
    porCuota.set(f.plan_cobro_cuota_id, f)
  }

  return {
    estado: 'ok',
    cuotas: filas.map((c) => {
      const f = porCuota.get(c.id)
      return {
        cuotaId: c.id,
        numero: c.numero,
        concepto: c.concepto_detalle,
        monto: Number(c.monto),
        fechaVencimiento: c.fecha_vencimiento,
        factura: f ? { numero: f.numero, pdf: Boolean(f.pdf_path), xml: Boolean(f.xml_path), cargadaAt: f.updated_at } : null,
      }
    }),
  }
}
