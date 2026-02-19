'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function saveTimerEntry(data: {
  project_id: string
  hours: number
  activity?: string
  category?: string
  start_time?: string
  end_time?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Sin perfil' }

  const { error } = await supabase.from('time_entries').insert({
    workspace_id: profile.workspace_id,
    project_id: data.project_id,
    user_id: user.id,
    hours: data.hours,
    activity: data.activity || null,
    category: data.category || null,
    start_time: data.start_time || null,
    end_time: data.end_time || null,
    entry_date: new Date().toISOString().split('T')[0],
    source: 'timer',
  })

  if (error) return { error: error.message }
  revalidatePath('/proyectos')
  return { success: true }
}

export async function getActiveProjects() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) return []

  const { data } = await supabase
    .from('projects')
    .select('id, name')
    .eq('workspace_id', profile.workspace_id)
    .in('status', ['active', 'rework'])
    .order('name')

  return data || []
}
