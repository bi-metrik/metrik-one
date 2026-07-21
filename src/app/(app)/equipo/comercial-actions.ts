'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import type { ComercialResumenRow, ComercialPerfil } from './comercial-types'

/**
 * Resumen comercial por responsable del workspace activo (incluye bucket sin
 * responsable). Alimenta la vista /equipo en workspaces con
 * modules.comercial_negocios. Sobre negocios+responsable_id, NO ventas_hechos.
 */
export async function getComercialResumen(): Promise<ComercialResumenRow[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_resumen_soena', {
    p_workspace_id: workspaceId,
  })
  return (data as ComercialResumenRow[]) ?? []
}

/**
 * Perfil de un responsable. staffId === 'sin-responsable' resuelve el bucket de
 * negocios sin responsable_id (la RPC lo interpreta como p_responsable_id NULL).
 */
export async function getComercialPerfil(staffId: string): Promise<ComercialPerfil | null> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId || !supabase) return null
  const responsableId = staffId === 'sin-responsable' ? null : staffId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_perfil_soena', {
    p_responsable_id: responsableId,
  })
  if (!data) return null
  return data as ComercialPerfil
}
