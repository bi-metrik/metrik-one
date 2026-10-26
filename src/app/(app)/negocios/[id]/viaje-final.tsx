import { leerVistaViajeFinal } from '@/lib/viaje/cierre-viaje-datos'
import { esAprobador, puedeConfirmarCliente } from '@/lib/viaje/confirmacion'
import { aprobadoresDeLinea } from '@/lib/viaje/estado-servicio'
import { cierreParaCerrar, type CierreParaCerrar } from '@/lib/viaje/cierre-viaje'
import ViajeFinalPanel from './viaje-final-panel'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * En viaje, Cierre económico y Postventa en el negocio (F6). Solo con `cierre_viaje.activo` en la
 * línea y en su etapa. Quién puede qué: las MISMAS funciones que usan las acciones (§7.4).
 */
export async function leerViajeFinal(
  supabase: Db,
  args: { workspaceId: string; negocioId: string; staffId: string | null; role: string | null; areas: string[] },
): Promise<{ panel: React.ReactNode; paraCerrar: CierreParaCerrar | null }> {
  let vista
  try {
    vista = await leerVistaViajeFinal(supabase, args.workspaceId, args.negocioId)
  } catch (e) {
    console.warn('[negocio] no se pudo leer el cierre del viaje:', e instanceof Error ? e.message : e)
    return { panel: null, paraCerrar: null }
  }
  if (!vista) return { panel: null, paraCerrar: null }
  // El diálogo de «Cerrar negocio» muestra el margen del panel y lo que falta de postventa.
  const paraCerrar = cierreParaCerrar(vista.cierre, vista.fase === 'postventa' ? vista.faltaPostventa : null)
  const [{ data: linea }, { data: resp }] = await Promise.all([
    supabase.from('negocios').select('lineas_negocio(config_extra)').eq('id', args.negocioId).maybeSingle(),
    args.staffId
      ? supabase.from('negocio_responsables').select('staff_id').eq('negocio_id', args.negocioId).eq('staff_id', args.staffId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const l = (linea as { lineas_negocio?: unknown } | null)?.lineas_negocio
  const config = (Array.isArray(l) ? l[0] : l) as { config_extra?: unknown } | null
  const quien = { role: args.role, staffId: args.staffId, areas: args.areas, aprobadores: aprobadoresDeLinea(config?.config_extra), esResponsable: !!resp }
  const comercial = puedeConfirmarCliente(quien)
  const operaciones = args.areas.includes('operaciones')
  const panel = (
    <ViajeFinalPanel
      vista={vista}
      esDireccion={esAprobador(quien)}
      puedeAnotar={comercial || operaciones}
      puedePostventa={comercial}
      puedeComision={esAprobador(quien) || operaciones}
    />
  )
  return { panel, paraCerrar }
}
