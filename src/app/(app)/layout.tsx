import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
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

  // Dev workspace override: cookie __dev_ws=<slug> impersona cualquier workspace
  let activeWorkspaceId: string = profile.workspace_id
  let activeClient = supabase as ReturnType<typeof createServiceClient>
  if (process.env.NODE_ENV === 'development') {
    const cookieStore = await cookies()
    const devSlug = cookieStore.get('__dev_ws')?.value
    if (devSlug) {
      const svc = createServiceClient()
      const { data: ws } = await svc.from('workspaces').select('id').eq('slug', devSlug).single()
      if (ws?.id) {
        activeWorkspaceId = ws.id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        activeClient = svc as any
      }
    }
  }

  const [workspaceResult, fiscalResult, modulesResult] = await Promise.all([
    activeClient
      .from('workspaces')
      .select('name, slug, color_primario, color_secundario, logo_url')
      .eq('id', activeWorkspaceId)
      .single(),
    activeClient
      .from('fiscal_profiles')
      .select('is_complete, is_estimated, nudge_count')
      .eq('workspace_id', activeWorkspaceId)
      .single(),
    // modules column added in migration 20260409300001 — not in generated types yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (activeClient.from('workspaces') as any)
      .select('modules')
      .eq('id', activeWorkspaceId)
      .single() as Promise<{ data: { modules: Record<string, boolean> | null } | null; error: unknown }>,
  ])

  const workspace = workspaceResult.data
  if (!workspace) {
    redirect('/onboarding')
  }

  const workspaceModules = (modulesResult.data?.modules as Record<string, boolean> | null) ?? { business: true }

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
      modules={workspaceModules}
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
