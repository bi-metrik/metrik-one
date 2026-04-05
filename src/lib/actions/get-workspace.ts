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
    .select('workspace_id, role, full_name')
    .eq('id', user.id)
    .single()

  if (!profile?.workspace_id) {
    return { supabase, workspaceId: null, userId: user.id, role: null, staffId: null, error: 'Sin perfil' as const }
  }

  let { data: staffRecord } = await supabase
    .from('staff')
    .select('id')
    .eq('profile_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  // Auto-crear registro staff si el usuario autenticado no tiene uno vinculado.
  // Ocurre cuando el owner crea el workspace antes de que exista el trigger de sincronización.
  if (!staffRecord) {
    const rolMap: Record<string, string> = {
      owner: 'dueno',
      admin: 'administrador',
      operator: 'operativo',
      supervisor: 'supervisor',
      read_only: 'operativo',
      contador: 'operativo',
    }
    const { data: created } = await supabase
      .from('staff')
      .insert({
        workspace_id: profile.workspace_id,
        full_name: (profile as { full_name?: string }).full_name ?? 'Usuario',
        profile_id: user.id,
        rol_plataforma: rolMap[profile.role ?? 'owner'] ?? 'dueno',
        is_active: true,
      })
      .select('id')
      .single()
    staffRecord = created
  }

  return {
    supabase,
    workspaceId: profile.workspace_id as string,
    userId: user.id,
    role: (profile.role ?? 'read_only') as string,
    staffId: staffRecord?.id ?? null,
    error: null,
  }
}
