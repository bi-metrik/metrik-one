import { leerVistaRiel } from '@/lib/viaje/riel-cobro-datos'
import { puedeConfirmarCliente } from '@/lib/viaje/confirmacion'
import { aprobadoresDeLinea } from '@/lib/viaje/estado-servicio'
import RielCobroPanel from './riel-cobro-panel'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * El riel de cobro en la cabecera del negocio (F2). Solo con `plan_pagos.activo` y un plan
 * acordado; si no, no lee más ni pinta nada. Quién registra pagos: la MISMA función que usa la
 * acción del servidor (Vera C15).
 */
export async function leerRielCobro(
  supabase: Db,
  args: { workspaceId: string; negocioId: string; staffId: string | null; role: string | null; areas: string[] },
): Promise<React.ReactNode> {
  let vista
  try {
    vista = await leerVistaRiel(supabase, args.workspaceId, args.negocioId)
  } catch (e) {
    console.warn('[negocio] no se pudo leer el riel de cobro:', e instanceof Error ? e.message : e)
    return null
  }
  if (!vista) return null
  const [{ data: linea }, { data: resp }] = await Promise.all([
    supabase.from('negocios').select('lineas_negocio(config_extra)').eq('id', args.negocioId).maybeSingle(),
    args.staffId
      ? supabase.from('negocio_responsables').select('staff_id').eq('negocio_id', args.negocioId).eq('staff_id', args.staffId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const l = (linea as { lineas_negocio?: unknown } | null)?.lineas_negocio
  const config = (Array.isArray(l) ? l[0] : l) as { config_extra?: unknown } | null
  const puede = puedeConfirmarCliente({
    role: args.role,
    staffId: args.staffId,
    areas: args.areas,
    aprobadores: aprobadoresDeLinea(config?.config_extra),
    esResponsable: !!resp,
  })
  return <RielCobroPanel vista={vista} puedeRegistrar={puede} />
}
