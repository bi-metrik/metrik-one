import { leerVistaEntrega } from '@/lib/viaje/entrega-datos'
import { esAprobador, puedeConfirmarCliente } from '@/lib/viaje/confirmacion'
import { aprobadoresDeLinea } from '@/lib/viaje/estado-servicio'
import EntregaViajePanel from './entrega-viaje-panel'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * «Documentos y entrega» en el negocio (F4). Solo con `entrega_viaje.activo` en la línea, y solo
 * en la etapa que declara alguno de sus gates (o si el paquete ya salió: para avisar que cambió un
 * voucher). Quién puede qué: las MISMAS funciones que usan las acciones del servidor (§7.4).
 */
export async function leerEntregaViaje(
  supabase: Db,
  args: { workspaceId: string; negocioId: string; staffId: string | null; role: string | null; areas: string[] },
): Promise<React.ReactNode> {
  let vista
  try {
    vista = await leerVistaEntrega(supabase, args.workspaceId, args.negocioId)
  } catch (e) {
    console.warn('[negocio] no se pudo leer la entrega del viaje:', e instanceof Error ? e.message : e)
    return null
  }
  if (!vista || (vista.gates.length === 0 && !vista.paquete)) return null
  const [{ data: linea }, { data: resp }] = await Promise.all([
    supabase.from('negocios').select('lineas_negocio(config_extra)').eq('id', args.negocioId).maybeSingle(),
    args.staffId
      ? supabase.from('negocio_responsables').select('staff_id').eq('negocio_id', args.negocioId).eq('staff_id', args.staffId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const l = (linea as { lineas_negocio?: unknown } | null)?.lineas_negocio
  const config = (Array.isArray(l) ? l[0] : l) as { config_extra?: unknown } | null
  const quien = {
    role: args.role,
    staffId: args.staffId,
    areas: args.areas,
    aprobadores: aprobadoresDeLinea(config?.config_extra),
    esResponsable: !!resp,
  }
  const puedeEnviar = puedeConfirmarCliente(quien)
  return (
    <EntregaViajePanel
      vista={vista}
      puedeEnviar={puedeEnviar}
      esDireccion={esAprobador(quien)}
      puedeDocumentos={puedeEnviar || args.areas.includes('operaciones')}
    />
  )
}
