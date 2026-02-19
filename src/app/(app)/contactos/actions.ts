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

// ── Contacts ──────────────────────────────────────────────

export async function getContacts() {
  const { supabase, workspaceId } = await getWorkspace()

  // Fetch contacts, clients, and promoters separately then join in JS
  // (Supabase types don't have Relationships defined for these tables)
  const [contactsRes, clientsRes, promotersRes] = await Promise.all([
    supabase
      .from('contacts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    supabase
      .from('clients')
      .select('id, name, nit, digito_verificacion, person_type')
      .eq('workspace_id', workspaceId),
    supabase
      .from('promoters')
      .select('id, name')
      .eq('workspace_id', workspaceId),
  ])

  const contacts = contactsRes.data ?? []
  const clientsMap = new Map((clientsRes.data ?? []).map(c => [c.id, c]))
  const promotersMap = new Map((promotersRes.data ?? []).map(p => [p.id, p]))
  const contactsMap = new Map(contacts.map(c => [c.id, c]))

  return contacts.map(c => ({
    ...c,
    client: c.client_id ? clientsMap.get(c.client_id) ?? null : null,
    promoter: c.promoter_id ? promotersMap.get(c.promoter_id) ?? null : null,
    referred_by: c.referred_by_id ? (() => {
      const ref = contactsMap.get(c.referred_by_id)
      return ref ? { id: ref.id, full_name: ref.full_name, email: ref.email } : null
    })() : null,
  }))
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
  country?: string
  notes?: string
  client_id?: string
  promoter_id?: string
  referred_by_id?: string
}) {
  const { supabase, workspaceId } = await getWorkspace()

  const { error } = await supabase.from('contacts').insert({
    workspace_id: workspaceId,
    full_name: formData.full_name,
    email: formData.email || null,
    phone: formData.phone || null,
    company: formData.company || null,
    position: formData.position || null,
    contact_type: formData.contact_type || 'Cliente',
    source: formData.source || null,
    city: formData.city || null,
    country: formData.country || 'Colombia',
    notes: formData.notes || null,
    client_id: formData.client_id || null,
    promoter_id: formData.promoter_id || null,
    referred_by_id: formData.referred_by_id || null,
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
    country?: string | null
    notes?: string | null
    client_id?: string | null
    promoter_id?: string | null
    referred_by_id?: string | null
  }
) {
  const { supabase, workspaceId } = await getWorkspace()

  const { error } = await supabase
    .from('contacts')
    .update(formData)
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (error) return { error: error.message }
  revalidatePath('/contactos')
  return { success: true }
}

export async function deleteContact(id: string) {
  const { supabase, workspaceId } = await getWorkspace()

  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (error) return { error: error.message }
  revalidatePath('/contactos')
  return { success: true }
}

export async function convertToPromoter(contactId: string) {
  const { supabase, workspaceId } = await getWorkspace()

  // 1. Get contact data
  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)
    .single()

  if (contactErr || !contact) return { error: 'Contacto no encontrado' }

  // 2. Insert into promoters table
  const { data: promoter, error: promErr } = await supabase
    .from('promoters')
    .insert({
      workspace_id: workspaceId,
      name: contact.full_name,
      email: contact.email || null,
      phone: contact.phone || null,
      status: 'active',
      commission_pct: 10,
    })
    .select('id, name')
    .single()

  if (promErr || !promoter) return { error: promErr?.message || 'Error al crear promotor' }

  // 3. Update contact type to Promotor and link promoter
  await supabase
    .from('contacts')
    .update({ contact_type: 'Promotor', promoter_id: promoter.id })
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)

  revalidatePath('/contactos')
  revalidatePath('/promotores')
  return { success: true, promoter }
}

// ── Clients / Empresas ────────────────────────────────────

export async function getClients() {
  const { supabase, workspaceId } = await getWorkspace()

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('name')

  // Get contact counts per client
  const { data: contactCounts } = await supabase
    .from('contacts')
    .select('client_id')
    .eq('workspace_id', workspaceId)
    .not('client_id', 'is', null)

  const countMap: Record<string, number> = {}
  contactCounts?.forEach(c => {
    if (c.client_id) countMap[c.client_id] = (countMap[c.client_id] || 0) + 1
  })

  return (clients ?? []).map(c => ({
    ...c,
    contacts_count: countMap[c.id] || 0,
  }))
}

export async function createCompany(formData: {
  name: string
  razon_social?: string
  nit?: string
  digito_verificacion?: string
  person_type?: string
  sector?: string
  agente_retenedor?: boolean
  gran_contribuyente?: boolean
  regimen_simple?: boolean
  email?: string
  city?: string
  notes?: string
}) {
  const { supabase, workspaceId } = await getWorkspace()

  const { data, error } = await supabase
    .from('clients')
    .insert({
      workspace_id: workspaceId,
      name: formData.name,
      razon_social: formData.razon_social || null,
      nit: formData.nit || null,
      digito_verificacion: formData.digito_verificacion || null,
      person_type: formData.person_type || null,
      sector: formData.sector || null,
      agente_retenedor: formData.agente_retenedor || false,
      gran_contribuyente: formData.gran_contribuyente || false,
      regimen_simple: formData.regimen_simple || false,
      email: formData.email || null,
      city: formData.city || null,
      notes: formData.notes || null,
      is_active: true,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/contactos')
  return { success: true, clientId: data?.id }
}

export async function updateCompany(
  id: string,
  formData: {
    name?: string
    razon_social?: string | null
    nit?: string | null
    digito_verificacion?: string | null
    person_type?: string | null
    sector?: string | null
    agente_retenedor?: boolean
    gran_contribuyente?: boolean
    regimen_simple?: boolean
    email?: string | null
    city?: string | null
    notes?: string | null
  }
) {
  const { supabase, workspaceId } = await getWorkspace()

  const { error } = await supabase
    .from('clients')
    .update(formData)
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (error) return { error: error.message }
  revalidatePath('/contactos')
  return { success: true }
}

export async function deleteCompany(id: string) {
  const { supabase, workspaceId } = await getWorkspace()

  // Soft delete
  const { error } = await supabase
    .from('clients')
    .update({ is_active: false })
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (error) return { error: error.message }
  revalidatePath('/contactos')
  return { success: true }
}

export async function searchClients(query: string) {
  const { supabase, workspaceId } = await getWorkspace()

  const { data } = await supabase
    .from('clients')
    .select('id, name, nit, digito_verificacion, person_type, agente_retenedor, gran_contribuyente, regimen_simple')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .or(`name.ilike.%${query}%,nit.ilike.%${query}%`)
    .order('name')
    .limit(10)

  return data ?? []
}

// ── Promoters & Contacts for selects ─────────────────────

export async function getPromotersForSelect() {
  const { supabase, workspaceId } = await getWorkspace()

  const { data } = await supabase
    .from('promoters')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('name')

  return data ?? []
}

export async function getContactsForSelect() {
  const { supabase, workspaceId } = await getWorkspace()

  const { data } = await supabase
    .from('contacts')
    .select('id, full_name, email')
    .eq('workspace_id', workspaceId)
    .order('full_name')

  return data ?? []
}
