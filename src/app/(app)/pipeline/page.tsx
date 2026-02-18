import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PipelineBoard from './pipeline-board'

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/onboarding')

  const workspaceId = profile.workspace_id

  // Fetch opportunities
  const { data: rawOpportunities } = await supabase
    .from('opportunities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  // Fetch clients for this workspace
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .eq('workspace_id', workspaceId)

  // Map client names to opportunities
  const clientMap = new Map((clients || []).map(c => [c.id, c.name]))
  const opportunities = (rawOpportunities || []).map(opp => ({
    ...opp,
    clients: opp.client_id ? { name: clientMap.get(opp.client_id) || '' } : null,
  }))

  return <PipelineBoard initialOpportunities={opportunities} />
}
