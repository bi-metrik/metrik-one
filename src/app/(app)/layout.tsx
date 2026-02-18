import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from './app-shell'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  // Get user profile + workspace
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    // New user — needs onboarding
    redirect('/onboarding')
  }

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name, slug')
    .eq('id', profile.workspace_id)
    .single()

  if (!workspace) {
    redirect('/onboarding')
  }

  return (
    <AppShell
      fullName={profile.full_name || 'Usuario'}
      workspaceName={workspace.name}
      workspaceSlug={workspace.slug}
      role={profile.role}
    >
      {children}
    </AppShell>
  )
}
