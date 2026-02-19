'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getWorkspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role, full_name')
    .eq('id', user.id)
    .single()

  if (!profile) return null
  return { supabase, workspaceId: profile.workspace_id, role: profile.role, userId: user.id, fullName: profile.full_name }
}

export async function getNotes(entityType: string, entityId: string) {
  const ctx = await getWorkspace()
  if (!ctx) return []

  const { data } = await ctx.supabase
    .from('notes')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })

  return data || []
}

export async function addNote(entityType: string, entityId: string, content: string, noteType: string = 'nota') {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  const { error } = await ctx.supabase.from('notes').insert({
    workspace_id: ctx.workspaceId,
    entity_type: entityType,
    entity_id: entityId,
    note_type: noteType,
    content,
    created_by: ctx.userId,
  })

  if (error) return { error: error.message }
  return { success: true }
}

export async function deleteNote(noteId: string) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  const { error } = await ctx.supabase
    .from('notes')
    .delete()
    .eq('id', noteId)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { error: error.message }
  return { success: true }
}
