'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { rpcTablero } from '@/lib/tableros/cache-rpc'
import { getRolePermissions } from '@/lib/roles'
import { normalizarSegundoPago, type SegundoPagoMes } from '@/lib/tableros/segundo-pago'

/**
 * Las dos cifras de segundo pago de un mes, con los negocios detrás de cada una
 * (SOE-002). La leen Dirección y Comercial: una sola fuente para que los dos tableros
 * digan lo mismo.
 *
 * Mismo gate que Dirección y que la pestaña Comercial: cifras agregadas de toda la
 * operación, para quien tiene rol gerencial. El detalle viaja con la cifra (son pocos
 * negocios al mes), así la lista que se abre es exactamente la que sumó.
 *
 * `null` si falla o no aplica: la pantalla calla en vez de pintar un $0, que se leería
 * como "nadie pagó".
 */
export async function getSegundoPagoMes(anio: number, mes: number): Promise<SegundoPagoMes | null> {
  const { supabase, workspaceId, role } = await getWorkspace()
  if (!supabase || !workspaceId) return null

  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) return null
  if (!['owner', 'admin', 'supervisor'].includes(role || '')) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await rpcTablero(supabase as any, workspaceId, 'get_segundo_pago_mes_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  if (error) {
    console.error('[tableros] no se pudo traer el segundo pago del mes:', error)
    return null
  }
  return normalizarSegundoPago(data)
}
