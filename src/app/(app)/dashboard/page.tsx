import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardClient from './dashboard-client'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/onboarding')

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name, profession, subscription_status, trial_ends_at, onboarding_completed')
    .eq('id', profile.workspace_id)
    .single()

  if (!workspace) redirect('/onboarding')

  // Calculate trial days remaining
  const trialDaysLeft = workspace.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(workspace.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0

  return (
    <DashboardClient
      fullName={profile.full_name || 'Usuario'}
      workspaceName={workspace.name}
      subscriptionStatus={workspace.subscription_status}
      trialDaysLeft={trialDaysLeft}
    />
  )
}
