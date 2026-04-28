'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getWorkspace } from '@/lib/actions/get-workspace'

export interface SkillRow {
  id: string
  nombre: string
  skill_id: string | null
  tipo: number | null
  descripcion: string | null
  argument_hint: string | null
  disable_model_invocation: boolean
  allowed_tools: string[]
  user_invocable: boolean
  effort: string | null
  contenido: string | null
  ultima_sync: string
  created_at: string
  updated_at: string
}

async function requireAdmin(): Promise<string | null> {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) {
    return 'forbidden'
  }
  return null
}

export async function listSkills(): Promise<SkillRow[]> {
  const err = await requireAdmin()
  if (err) return []
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await ((svc as any).from('admin_skills'))
    .select('*')
    .order('tipo', { ascending: true, nullsFirst: false })
    .order('skill_id', { ascending: true, nullsFirst: false })
  if (error) return []
  return (data ?? []) as SkillRow[]
}
