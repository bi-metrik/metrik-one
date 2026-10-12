import { leerVistaConfirmacion } from '@/lib/viaje/confirmacion-datos'
import { esAprobador, puedeConfirmarCliente } from '@/lib/viaje/confirmacion'
import ConfirmacionViajePanel from './confirmacion-viaje-panel'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * La etapa Confirmación del viaje en la ficha (F2). Lee en el servidor, con la sesión de quien
 * mira; con `plan_pagos.activo` apagado en la línea no lee nada más y no pinta nada (como hoy).
 * Los permisos son la MISMA función que usan las acciones (Vera C15): la pantalla solo esconde.
 */
export async function leerConfirmacionViaje(
  supabase: Db,
  args: { workspaceId: string; negocioId: string; staffId: string | null; role: string | null; areas: string[] },
): Promise<React.ReactNode> {
  let vista
  try {
    vista = await leerVistaConfirmacion(supabase, args.workspaceId, args.negocioId)
  } catch (e) {
    console.warn('[negocio] no se pudo leer la confirmación del viaje:', e instanceof Error ? e.message : e)
    return null
  }
  if (!vista) return null
  let esResponsable = false
  if (args.staffId) {
    const { data } = await supabase
      .from('negocio_responsables')
      .select('staff_id')
      .eq('negocio_id', args.negocioId)
      .eq('staff_id', args.staffId)
      .maybeSingle()
    esResponsable = !!data
  }
  const quien = { role: args.role, staffId: args.staffId, areas: args.areas, aprobadores: vista.aprobadores, esResponsable }
  return <ConfirmacionViajePanel vista={vista} puedeConfirmar={puedeConfirmarCliente(quien)} esDireccion={esAprobador(quien)} />
}
