'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getWorkspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Sin workspace')
  return { supabase, workspaceId: profile.workspace_id }
}

export async function getPromoters() {
  const { supabase, workspaceId } = await getWorkspace()
  const { data, error } = await supabase
    .from('promoters')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createPromoter(formData: {
  name: string
  email?: string
  phone?: string
  commission_pct?: number
  status?: string
  bank_name?: string
  bank_account?: string
  notes?: string
}) {
  const { supabase, workspaceId } = await getWorkspace()
  const { error } = await supabase.from('promoters').insert({
    workspace_id: workspaceId,
    name: formData.name,
    email: formData.email || null,
    phone: formData.phone || null,
    commission_pct: formData.commission_pct ?? 10,
    status: formData.status || 'active',
    bank_name: formData.bank_name || null,
    bank_account: formData.bank_account || null,
    notes: formData.notes || null,
  })
  if (error) throw error
  revalidatePath('/promotores')
}

export async function updatePromoter(id: string, formData: {
  name?: string
  email?: string
  phone?: string
  commission_pct?: number
  status?: string
  bank_name?: string
  bank_account?: string
  notes?: string
}) {
  const { supabase } = await getWorkspace()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (formData.name !== undefined) updates.name = formData.name
  if (formData.email !== undefined) updates.email = formData.email || null
  if (formData.phone !== undefined) updates.phone = formData.phone || null
  if (formData.commission_pct !== undefined) updates.commission_pct = formData.commission_pct
  if (formData.status !== undefined) updates.status = formData.status
  if (formData.bank_name !== undefined) updates.bank_name = formData.bank_name || null
  if (formData.bank_account !== undefined) updates.bank_account = formData.bank_account || null
  if (formData.notes !== undefined) updates.notes = formData.notes || null

  const { error } = await supabase.from('promoters').update(updates).eq('id', id)
  if (error) throw error
  revalidatePath('/promotores')
}

export async function deletePromoter(id: string) {
  const { supabase } = await getWorkspace()
  const { error } = await supabase.from('promoters').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/promotores')
}
