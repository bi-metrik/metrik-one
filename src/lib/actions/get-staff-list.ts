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
