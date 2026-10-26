'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { rpcTablero } from '@/lib/tableros/cache-rpc'
import { getRolePermissions } from '@/lib/roles'
import { normalizarReembolsos, type ReembolsosMes } from '@/lib/tableros/reembolsos'

/**
 * Los reembolsos del mes, con la lista detrás (SOE-007). La leen Dirección y Comercial:
 * una sola fuente para que los dos tableros digan lo mismo.
 *
 * Mismo gate que Dirección y que la pestaña Comercial: cifras agregadas de toda la
 * operación, para quien tiene rol gerencial.
 *
 * `null` si falla o no aplica: la pantalla calla en vez de pintar un cero, que se leería
 * como «no hubo reembolsos».
 */
export async function getReembolsosMes(anio: number, mes: number): Promise<ReembolsosMes | null> {
  const { supabase, workspaceId, role } = await getWorkspace()
  if (!supabase || !workspaceId) return null

  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) return null
  if (!['owner', 'admin', 'supervisor'].includes(role || '')) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await rpcTablero(supabase as any, workspaceId, 'get_reembolsos_mes_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  if (error) {
    console.error('[tableros] no se pudieron traer los reembolsos del mes:', error)
    return null
  }
  return normalizarReembolsos(data)
}
