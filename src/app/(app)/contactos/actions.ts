'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getWorkspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return null
  return { supabase, workspaceId: profile.workspace_id, role: profile.role, userId: user.id }
}

export async function getContacts() {
  const ctx = await getWorkspace()
  if (!ctx) return []

  const { data } = await ctx.supabase
    .from('contacts')
    .select('*, clients(name)')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })

  return data || []
}

export async function createContact(formData: {
  full_name: string
  email?: string
  phone?: string
  company?: string
  position?: string
  contact_type?: string
  source?: string
  city?: string
  notes?: string
  client_id?: string
}) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  const { error } = await ctx.supabase.from('contacts').insert({
    workspace_id: ctx.workspaceId,
    full_name: formData.full_name,
    email: formData.email || null,
    phone: formData.phone || null,
    company: formData.company || null,
    position: formData.position || null,
    contact_type: formData.contact_type || 'cliente',
    source: formData.source || null,
    city: formData.city || null,
    notes: formData.notes || null,
    client_id: formData.client_id || null,
    status: 'sin_contactar',
  })

  if (error) return { error: error.message }
  revalidatePath('/contactos')
  return { success: true }
}

export async function updateContact(
  id: string,
  formData: {
    full_name?: string
    email?: string | null
    phone?: string | null
    company?: string | null
    position?: string | null
    contact_type?: string
    source?: string | null
    city?: string | null
    notes?: string | null
    client_id?: string | null
    status?: string
  }
) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  const { error } = await ctx.supabase
    .from('contacts')
    .update(formData)
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { error: error.message }
  revalidatePath('/contactos')
  return { success: true }
}

export async function deleteContact(id: string) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  const { error } = await ctx.supabase
    .from('contacts')
    .delete()
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { error: error.message }
  revalidatePath('/contactos')
  return { success: true }
}

export async function createOpportunityFromContact(contactId: string) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  // Get contact info
  const { data: contact } = await ctx.supabase
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (!contact) return { error: 'Contacto no encontrado' }

  // Create opportunity linked to this contact
  const { data: opp, error: oppErr } = await ctx.supabase
    .from('opportunities')
    .insert({
      workspace_id: ctx.workspaceId,
      name: `Oportunidad - ${contact.full_name}`,
      client_id: contact.client_id || null,
      contact_id: contactId,
      estimated_value: 0,
      stage: 'lead',
      probability: 10,
      source: contact.source || 'contacto',
    })
    .select('id')
    .single()

  if (oppErr) return { error: oppErr.message }

  if (!opp) return { error: 'Error al crear oportunidad' }

  // Update contact status to convertido
  await ctx.supabase
    .from('contacts')
    .update({ status: 'convertido' })
    .eq('id', contactId)

  revalidatePath('/contactos')
  revalidatePath('/pipeline')
  return { success: true, opportunityId: opp.id }
}
