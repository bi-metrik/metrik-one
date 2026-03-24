import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from './app-shell'
import FiscalNudge from './fiscal-nudge'
import NotificationBell from '@/components/notification-bell'

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

  // Get user profile + workspace — includes display_role added in sprint 10
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, workspace_id, display_role')
    .eq('id', user.id)
    .single()

  if (!profile) {
    // New user — needs onboarding
    redirect('/onboarding')
  }

  const [workspaceResult, fiscalResult] = await Promise.all([
    supabase
      .from('workspaces')
      .select('name, slug, color_primario, color_secundario, logo_url')
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
      displayRole={profile.display_role ?? null}
      isAdminWorkspace={profile.workspace_id === process.env.ADMIN_WORKSPACE_ID}
      branding={{
        colorPrimario: workspace.color_primario ?? undefined,
        colorSecundario: workspace.color_secundario ?? undefined,
        logoUrl: workspace.logo_url ?? undefined,
      }}
      notificationBell={<NotificationBell userId={user.id} />}
    >
      {/* D235/D236: Fiscal nudge — shows when profile incomplete, max 3 nudges. Not for contador. */}
      {fiscal && !fiscal.is_complete && profile.role !== 'contador' && (
        <div className="mb-4">
          <FiscalNudge
            isComplete={fiscal.is_complete ?? false}
            isEstimated={fiscal.is_estimated ?? false}
            nudgeCount={fiscal.nudge_count ?? 0}
          />
        </div>
      )}
      {children}
    </AppShell>
  )
}
