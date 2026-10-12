import { createServiceClient } from '@/lib/supabase/server'
import { reglaDelNegocio } from '@/lib/facturacion/cola-viaje'
import { configFacturacionLinea, pildoraFactura } from '@/lib/facturacion/regla-viaje'
import { esAprobador, puedeConfirmarCliente, type TitularFacturacion } from '@/lib/viaje/confirmacion'
import { aprobadoresDeLinea } from '@/lib/viaje/estado-servicio'
import FacturaViajePanel from './factura-viaje-panel'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * El riel de facturación del viaje en la cabecera (F5, Noor «Riel B»): una píldora con el estado
 * de la factura en palabras, los datos de facturación (editables hasta emitir) y «Facturar ya»
 * para la dirección. Solo en líneas con `facturacion.por_titular`; en las demás no lee más ni
 * pinta nada.
 */
export async function leerFacturaViaje(
  supabase: Db,
  args: { workspaceId: string; negocioId: string; staffId: string | null; role: string | null; areas: string[] },
): Promise<React.ReactNode> {
  try {
    const { data } = await supabase
      .from('negocios')
      .select('metadata, lineas_negocio(config_extra)')
      .eq('id', args.negocioId)
      .eq('workspace_id', args.workspaceId)
      .maybeSingle()
    if (!data) return null
    const l = (data as { lineas_negocio?: unknown }).lineas_negocio
    const configLinea = ((Array.isArray(l) ? l[0] : l) as { config_extra?: unknown } | null)?.config_extra ?? null
    const f = configFacturacionLinea(configLinea)
    if (!f.porTitular) return null
    const metadata = ((data as { metadata?: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>

    const regla = await reglaDelNegocio(createServiceClient(), args.workspaceId, args.negocioId)
    if (!regla) return null
    const facturaNumero = (metadata.siigo_factura as { numero?: string } | undefined)?.numero ?? null
    const pildora = pildoraFactura({
      activa: regla.regla === 'viaje',
      estado: regla.regla === 'viaje'
        ? regla.estado
        : { titular: null, confirmado: false, paqueteEnviado: false, saldo: 0, forzada: false },
      facturaNumero,
    })

    const { data: resp } = args.staffId
      ? await supabase.from('negocio_responsables').select('staff_id').eq('negocio_id', args.negocioId).eq('staff_id', args.staffId).maybeSingle()
      : { data: null }
    const quien = {
      role: args.role,
      staffId: args.staffId,
      areas: args.areas,
      aprobadores: aprobadoresDeLinea(configLinea),
      esResponsable: !!resp,
    }
    return (
      <FacturaViajePanel
        negocioId={args.negocioId}
        pildora={pildora}
        titular={(metadata.titular_facturacion ?? null) as TitularFacturacion | null}
        puedeEditar={!facturaNumero && puedeConfirmarCliente(quien)}
        puedeForzar={!facturaNumero && pildora.estado === 'espera' && esAprobador(quien)}
      />
    )
  } catch (e) {
    console.warn('[negocio] no se pudo leer la factura del viaje:', e instanceof Error ? e.message : e)
    return null
  }
}
