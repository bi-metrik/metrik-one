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
    return { supabase, workspaceId: null, userId: null, role: null, error: 'No autenticado' as const }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.workspace_id) {
    return { supabase, workspaceId: null, userId: user.id, role: null, error: 'Sin perfil' as const }
  }

  return {
    supabase,
    workspaceId: profile.workspace_id as string,
    userId: user.id,
    role: (profile.role ?? 'read_only') as string,
    error: null,
  }
}
