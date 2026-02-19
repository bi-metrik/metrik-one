import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import OpportunityDetailClient from './opportunity-detail-client'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OpportunityDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/onboarding')

  // Parallel data fetches
  const [oppResult, quotesResult, clientsResult] = await Promise.all([
    supabase
      .from('opportunities')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', profile.workspace_id)
      .single(),
    supabase
      .from('quotes')
      .select('*')
      .eq('opportunity_id', id)
      .eq('workspace_id', profile.workspace_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('clients')
      .select('id, name, person_type, tax_regime, gran_contribuyente, agente_retenedor')
      .eq('workspace_id', profile.workspace_id)
      .eq('is_active', true)
      .order('name'),
  ])

  if (!oppResult.data) notFound()

  // Resolve client data manually
  const opp = oppResult.data
  const clientData = opp.client_id
    ? (clientsResult.data || []).find(c => c.id === opp.client_id) || null
    : null

  return (
    <OpportunityDetailClient
      opportunity={{
        ...opp,
        clients: clientData,
      }}
      quotes={quotesResult.data || []}
      clients={(clientsResult.data || []).map(c => ({ id: c.id, name: c.name }))}
    />
  )
}
