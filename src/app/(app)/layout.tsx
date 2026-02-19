import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from './app-shell'
import FiscalNudge from './fiscal-nudge'

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

  const [workspaceResult, fiscalResult] = await Promise.all([
    supabase
      .from('workspaces')
      .select('name, slug')
      .eq('id', profile.workspace_id)
      .single(),
    supabase
      .from('fiscal_profiles')
      .select('is_complete, is_estimated, nudge_count')
      .eq('workspace_id', profile.workspace_id)
      .single(),
  ])

  const workspace = workspaceResult.data
  if (!workspace) {
    redirect('/onboarding')
  }

  const fiscal = fiscalResult.data

  return (
    <AppShell
      fullName={profile.full_name || 'Usuario'}
      workspaceName={workspace.name}
      workspaceSlug={workspace.slug}
      role={profile.role}
    >
      {/* D235/D236: Fiscal nudge banner — shows when profile incomplete, max 3 nudges */}
      {fiscal && !fiscal.is_complete && (
        <div className="mb-4">
          <FiscalNudge
            isComplete={fiscal.is_complete}
            isEstimated={fiscal.is_estimated}
            nudgeCount={fiscal.nudge_count}
          />
        </div>
      )}
      {children}
    </AppShell>
  )
}
