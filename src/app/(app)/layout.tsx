import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import AppShell from './app-shell'
import FiscalNudge from './fiscal-nudge'
import NotificationBell from '@/components/notification-bell'
import DevWorkspaceBar from '@/components/dev-workspace-bar'
import { getPlatformAdminState } from '@/lib/actions/platform-admin'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getCachedUser } from '@/lib/supabase/auth-user'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  // getUser deduplicado por request (React cache): layout + getWorkspace lo
  // comparten → 1 sola llamada a Supabase Auth por render (antes 2).
  const { user, error } = await getCachedUser()

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

  // Rol EFECTIVO (respeta impersonación "Ver como" vía getWorkspace). Sin impersonar,
  // = rol real del profile → ningún cambio para usuarios normales. Necesario para que
  // el nav del sidebar refleje el rol impersonado (antes usaba el rol real del owner →
  // al impersonar un operator seguía mostrando Configuración y demás items).
  const { role: rolEfectivo } = await getWorkspace()
  const navRole = rolEfectivo ?? profile.role

  // El header muestra el Cargo (staff.position) del usuario; si no tiene, cae al
  // rol (fallback en AppShell). Fuente unica de "como se llama el puesto"
  // (2026-06-04: se elimino el campo separado "Nombre personalizado").
  const { data: staffSelf } = await supabase
    .from('staff')
    .select('position')
    .eq('profile_id', user.id)
    .eq('workspace_id', profile.workspace_id)
    .maybeSingle()

  // Dev workspace override: cookie __dev_ws=<slug> impersona cualquier workspace
  let activeWorkspaceId: string = profile.workspace_id
  let activeSlug: string | null = null
  let allWorkspaces: { slug: string; name: string }[] = []
  let activeClient = supabase as ReturnType<typeof createServiceClient>
  if (process.env.NODE_ENV === 'development') {
    const svc = createServiceClient()
    const cookieStore = await cookies()
    const devSlug = cookieStore.get('__dev_ws')?.value
    // Load all workspaces for the switcher
    const { data: wsAll } = await svc.from('workspaces').select('slug, name').order('name')
    allWorkspaces = wsAll ?? []
    if (devSlug) {
      const ws = allWorkspaces.find(w => w.slug === devSlug)
      if (ws) {
        activeWorkspaceId = (await svc.from('workspaces').select('id').eq('slug', devSlug).single()).data?.id ?? activeWorkspaceId
        activeSlug = devSlug
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        activeClient = svc as any
      }
    }
    if (!activeSlug) {
      // Mostrar el workspace real del perfil como activo
      const { data: myWs } = await svc.from('workspaces').select('slug').eq('id', profile.workspace_id).single()
      activeSlug = myWs?.slug ?? null
    }
  }

  const [workspaceResult, fiscalResult, modulesResult, lineasResult] = await Promise.all([
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
      .select('modules, config_extra')
      .eq('id', activeWorkspaceId)
      .single() as Promise<{ data: { modules: Record<string, boolean> | null; config_extra: Record<string, unknown> | null } | null; error: unknown }>,
    // hasLineas: workspace tiene al menos una linea activa → habilita item /flujo
    activeClient
      .from('lineas_negocio')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', activeWorkspaceId)
      .eq('is_active', true),
  ])

  const workspace = workspaceResult.data
  if (!workspace) {
    redirect('/onboarding')
  }

  const workspaceModules = (modulesResult.data?.modules as Record<string, boolean> | null) ?? { business: true }
  // Override de visibilidad del nav por workspace (config-driven). Mapa { href: roles[] }
  // que reemplaza los roles por defecto de cada item del sidebar para ESTE workspace.
  // Sin override = comportamiento global intacto (resto de workspaces sin cambio).
  const navRolesOverride = (modulesResult.data?.config_extra as { nav_roles_override?: Record<string, string[]> } | null)
    ?.nav_roles_override ?? undefined
  const hasLineas = (lineasResult.count ?? 0) > 0

  const fiscal = fiscalResult.data

  const platformAdminState = await getPlatformAdminState()

  return (
    <>
      <AppShell
        fullName={profile.full_name || 'Usuario'}
        workspaceName={workspace.name}
        role={navRole}
        displayRole={staffSelf?.position ?? null}
        isAdminWorkspace={profile.workspace_id === process.env.ADMIN_WORKSPACE_ID}
        platformAdminState={platformAdminState}
        branding={{
          colorPrimario: workspace.color_primario ?? undefined,
          colorSecundario: workspace.color_secundario ?? undefined,
          logoUrl: workspace.logo_url ?? undefined,
        }}
        modules={workspaceModules}
        navRolesOverride={navRolesOverride}
        hasLineas={hasLineas}
        notificationBell={<NotificationBell userId={user.id} />}
      >
        {/* D235/D236: Fiscal nudge — shows when profile incomplete, max 3 nudges. Not for contador. */}
        {fiscal && !fiscal.is_complete && navRole !== 'contador' && (
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
      {process.env.NODE_ENV === 'development' && allWorkspaces.length > 0 && (
        <DevWorkspaceBar workspaces={allWorkspaces} activeSlug={activeSlug ?? ''} />
      )}
    </>
  )
}
