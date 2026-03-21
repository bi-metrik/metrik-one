'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Helper compartido para obtener workspace_id del usuario autenticado.
 * Patron: createClient() → auth.getUser() → profiles.workspace_id
 */
export async function getWorkspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, workspaceId: null, userId: null, role: null, staffId: null, error: 'No autenticado' as const }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.workspace_id) {
    return { supabase, workspaceId: null, userId: user.id, role: null, staffId: null, error: 'Sin perfil' as const }
  }

  const { data: staffRecord } = await supabase
    .from('staff')
    .select('id')
    .eq('profile_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  return {
    supabase,
    workspaceId: profile.workspace_id as string,
    userId: user.id,
    role: (profile.role ?? 'read_only') as string,
    staffId: staffRecord?.id ?? null,
    error: null,
  }
}
