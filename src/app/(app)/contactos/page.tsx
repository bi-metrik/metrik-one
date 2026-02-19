import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ContactosClient from './contactos-client'

export default async function ContactosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/onboarding')

  // Only owner/admin can see contacts
  if (!['owner', 'admin'].includes(profile.role)) {
    redirect('/dashboard')
  }

  const [contactsResult, clientsResult] = await Promise.all([
    supabase
      .from('contacts')
      .select('*')
      .eq('workspace_id', profile.workspace_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('clients')
      .select('id, name')
      .eq('workspace_id', profile.workspace_id)
      .eq('is_active', true)
      .order('name'),
  ])

  // Map client names (contacts is new table — join may not be in generated types)
  const clientMap = new Map((clientsResult.data || []).map(c => [c.id, c.name]))
  const contactsWithClients = (contactsResult.data || []).map(c => ({
    ...c,
    clients: c.client_id ? { name: clientMap.get(c.client_id) || '' } : null,
  }))

  return (
    <ContactosClient
      initialContacts={contactsWithClients}
      clients={clientsResult.data || []}
    />
  )
}
