'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'

export async function getActiveStaffList() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('staff')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('full_name')

  return data ?? []
}

export async function getActiveStaffByArea(area?: string): Promise<{ id: string; full_name: string; area: string | null; rol_plataforma: string | null }[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  let query = supabase
    .from('staff')
    .select('id, full_name, area, rol_plataforma')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('full_name')

  if (area) {
    query = query.eq('area', area)
  }

  const { data } = await query
  return (data ?? []).map(s => ({ id: s.id, full_name: s.full_name ?? 'Sin nombre', area: s.area, rol_plataforma: s.rol_plataforma }))
}
