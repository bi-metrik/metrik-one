'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ============================================================
// Tipos compartidos (cliente + servidor)
// ============================================================

export type WorkspaceSummary = {
  id: string
  slug: string
  name: string
}

export type PlatformAdminState = {
  platformAdmin: true
  currentWorkspace: WorkspaceSummary | null
  homeWorkspace: WorkspaceSummary | null
  workspaces: WorkspaceSummary[]
  isAway: boolean
}

// Profile shape para campos nuevos hasta regenerar database.ts post-migration
type ProfileExt = {
  id: string
  workspace_id: string
  home_workspace_id: string | null
  platform_admin: boolean
}

type CurrentUserCtx = {
  profile: ProfileExt
  email: string
}

async function getCurrentUserCtx(): Promise<CurrentUserCtx | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.email) return null

  const { data } = await supabase
    .from('profiles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('id, workspace_id, home_workspace_id, platform_admin' as any)
    .eq('id', user.id)
    .single()

  const profile = (data as unknown as ProfileExt | null) ?? null
  if (!profile) return null
  return { profile, email: user.email }
}

// Cookies en ONE son host-only entre subdomains (auth-js rechaza cross-subdomain).
// Para saltar a otro subdomain del tenant necesitamos sembrar sesion alli via magic link.
async function generateCrossSubdomainSessionLink(
  email: string,
  targetSlug: string,
  pathAfter: string = '/',
): Promise<string | null> {
  const svc = createServiceClient()
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co'
  const targetOrigin =
    process.env.NODE_ENV === 'development'
      ? `http://${targetSlug}.localhost:3000`
      : `https://${targetSlug}.${baseDomain}`

  const { data, error } = await svc.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${targetOrigin}/auth/callback?redirectTo=${encodeURIComponent(pathAfter)}` },
  })
  if (error) {
    console.error('[platform-admin] generateLink error:', error.message)
    return null
  }
  return data?.properties?.action_link ?? null
}

// ============================================================
// getPlatformAdminState — usado por el server layout para alimentar el bar
// ============================================================

export async function getPlatformAdminState(): Promise<PlatformAdminState | null> {
  const ctx = await getCurrentUserCtx()
  if (!ctx?.profile.platform_admin) return null
  const profile = ctx.profile

  const svc = createServiceClient()

  const { data: allWorkspaces } = await svc
    .from('workspaces')
    .select('id, slug, name')
    .order('name')

  const list: WorkspaceSummary[] =
    (allWorkspaces as WorkspaceSummary[] | null)?.map(w => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
    })) ?? []

  const currentWorkspace =
    list.find(w => w.id === profile.workspace_id) ?? null
  const homeWorkspace = profile.home_workspace_id
    ? (list.find(w => w.id === profile.home_workspace_id) ?? null)
    : null

  const isAway =
    profile.home_workspace_id != null &&
    profile.workspace_id !== profile.home_workspace_id

  return {
    platformAdmin: true,
    currentWorkspace,
    homeWorkspace,
    workspaces: list,
    isAway,
  }
}

// ============================================================
// switchWorkspace — platform admin entra a otro workspace
// ============================================================

export async function switchWorkspace(targetWorkspaceId: string) {
  const ctx = await getCurrentUserCtx()
  if (!ctx?.profile.platform_admin) return { error: 'No autorizado' }
  const profile = ctx.profile
  if (profile.workspace_id === targetWorkspaceId) {
    return { success: true } // no-op
  }

  const svc = createServiceClient()

  // Validar que target workspace existe
  const { data: target } = await svc
    .from('workspaces')
    .select('id, slug, name')
    .eq('id', targetWorkspaceId)
    .single()
  if (!target) return { error: 'Workspace destino no existe' }

  const updates: { workspace_id: string; home_workspace_id?: string } = {
    workspace_id: targetWorkspaceId,
  }
  // Primer switch: el workspace actual queda registrado como home
  if (!profile.home_workspace_id) {
    updates.home_workspace_id = profile.workspace_id
  }

  const { error: updateError } = await svc
    .from('profiles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(updates as any)
    .eq('id', profile.id)

  if (updateError) return { error: updateError.message }

  // Audit log en el workspace al que ENTRA — cualquier owner del tenant podra
  // ver la actividad del platform admin en su activity feed
  await svc.from('activity_log').insert({
    workspace_id: targetWorkspaceId,
    entidad_tipo: 'workspace',
    entidad_id: targetWorkspaceId,
    tipo: 'platform_admin_enter',
    autor_id: profile.id,
    contenido: 'Platform admin de MeTRIK entró en este workspace para soporte/debugging',
  })

  const targetSlug = (target as { slug: string }).slug
  // Genera magic link al subdomain destino para sembrar sesion alli (cookies host-only)
  const actionLink = await generateCrossSubdomainSessionLink(ctx.email, targetSlug, '/')

  revalidatePath('/', 'layout')
  return {
    success: true,
    targetSlug,
    actionLink,
  }
}

// ============================================================
// returnHome — platform admin vuelve a su workspace original
// ============================================================

export async function returnHome() {
  const ctx = await getCurrentUserCtx()
  if (!ctx?.profile.platform_admin) return { error: 'No autorizado' }
  const profile = ctx.profile
  if (!profile.home_workspace_id) return { error: 'No hay home workspace registrado' }
  if (profile.home_workspace_id === profile.workspace_id) {
    return { success: true } // ya estamos en home
  }

  const svc = createServiceClient()

  // Validar que home workspace existe (defensivo: por si fue borrado)
  const { data: home } = await svc
    .from('workspaces')
    .select('id, slug')
    .eq('id', profile.home_workspace_id)
    .single()
  if (!home) return { error: 'Home workspace ya no existe' }

  // Audit log en el workspace que ABANDONA
  await svc.from('activity_log').insert({
    workspace_id: profile.workspace_id,
    entidad_tipo: 'workspace',
    entidad_id: profile.workspace_id,
    tipo: 'platform_admin_exit',
    autor_id: profile.id,
    contenido: 'Platform admin de MeTRIK regresó a su workspace home',
  })

  const { error: updateError } = await svc
    .from('profiles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ workspace_id: profile.home_workspace_id } as any)
    .eq('id', profile.id)

  if (updateError) return { error: updateError.message }

  const targetSlug = (home as { slug: string }).slug
  const actionLink = await generateCrossSubdomainSessionLink(ctx.email, targetSlug, '/')

  revalidatePath('/', 'layout')
  return {
    success: true,
    targetSlug,
    actionLink,
  }
}
