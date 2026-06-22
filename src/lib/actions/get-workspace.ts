'use server'

import { cookies } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/supabase/auth-user'

const VALID_AREAS = ['comercial', 'operaciones', 'financiera', 'direccion'] as const

/**
 * Resuelve las áreas (staff_areas) de un staff. Vacío si no tiene.
 */
async function resolverAreas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  staffId: string | null,
): Promise<string[]> {
  if (!staffId) return []
  const { data } = await supabase.from('staff_areas').select('area').eq('staff_id', staffId)
  return ((data ?? []) as { area: string }[])
    .map((r) => r.area)
    .filter((a) => (VALID_AREAS as readonly string[]).includes(a))
}

/**
 * Helper compartido para obtener workspace_id del usuario autenticado.
 * Patron: createClient() → auth.getUser() → profiles.workspace_id
 *
 * Dev override: cookie __dev_ws=<slug> impersona cualquier workspace
 * usando service role (bypassa RLS). Solo activo en NODE_ENV=development.
 *
 * Impersonación QA: cookie __impersonate=<profile_id> hace "Ver como" otro
 * usuario del MISMO workspace. Solo se aplica si el usuario real es
 * platform_admin. Devuelve role/areas/staffId/userId del usuario impersonado
 * → todo el gating de aplicación (edición, filtros, permisos) lo hereda.
 * El cliente supabase sigue siendo el del admin real (RLS real); la
 * impersonación afecta solo el modelo de permisos de aplicación.
 */
export async function getWorkspace() {
  const supabase = await createClient()
  const { user } = await getCachedUser()

  if (!user) {
    return { supabase, workspaceId: null, userId: null, role: null, staffId: null, areas: [] as string[], impersonating: false, realRole: null, error: 'No autenticado' as const }
  }

  // ── Dev workspace override ────────────────────────────────────────────
  if (process.env.NODE_ENV === 'development') {
    const cookieStore = await cookies()
    const devSlug = cookieStore.get('__dev_ws')?.value
    if (devSlug) {
      const svc = createServiceClient()
      const { data: ws } = await svc
        .from('workspaces')
        .select('id')
        .eq('slug', devSlug)
        .single()
      if (ws?.id) {
        return {
          supabase: svc,
          workspaceId: ws.id as string,
          userId: user.id,
          role: 'owner' as string,
          staffId: null,
          areas: [] as string[],
          impersonating: false,
          realRole: 'owner' as string | null,
          error: null,
        }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role, full_name, platform_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.workspace_id) {
    return { supabase, workspaceId: null, userId: user.id, role: null, staffId: null, areas: [] as string[], impersonating: false, realRole: null, error: 'Sin perfil' as const }
  }

  const realRole = (profile.role ?? 'read_only') as string
  const realPlatformAdmin = (profile as { platform_admin?: boolean }).platform_admin === true

  let { data: staffRecord } = await supabase
    .from('staff')
    .select('id')
    .eq('profile_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  // Auto-crear registro staff si el usuario autenticado no tiene uno vinculado.
  if (!staffRecord) {
    const rolMap: Record<string, string> = {
      owner: 'dueno',
      admin: 'administrador',
      operator: 'operativo',
      supervisor: 'supervisor',
      read_only: 'operativo',
      contador: 'operativo',
    }
    const { data: created } = await supabase
      .from('staff')
      .insert({
        workspace_id: profile.workspace_id,
        full_name: (profile as { full_name?: string }).full_name ?? 'Usuario',
        profile_id: user.id,
        rol_plataforma: rolMap[profile.role ?? 'owner'] ?? 'dueno',
        is_active: true,
      })
      .select('id')
      .single()
    staffRecord = created
  }

  // ── Impersonación QA ("Ver como"): solo platform_admin ────────────────
  const cookieStore = await cookies()
  const impersonateId = cookieStore.get('__impersonate')?.value
  if (impersonateId && realPlatformAdmin && impersonateId !== user.id) {
    const { data: target } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', impersonateId)
      .eq('workspace_id', profile.workspace_id)
      .maybeSingle()
    if (target) {
      const { data: tStaff } = await supabase
        .from('staff')
        .select('id')
        .eq('profile_id', target.id)
        .eq('is_active', true)
        .maybeSingle()
      const tStaffId = (tStaff?.id as string | null) ?? null
      return {
        supabase,
        workspaceId: profile.workspace_id as string,
        userId: target.id as string,
        role: (target.role ?? 'read_only') as string,
        staffId: tStaffId,
        areas: await resolverAreas(supabase, tStaffId),
        impersonating: true,
        realRole,
        error: null,
      }
    }
  }

  return {
    supabase,
    workspaceId: profile.workspace_id as string,
    userId: user.id,
    role: realRole,
    staffId: staffRecord?.id ?? null,
    areas: await resolverAreas(supabase, staffRecord?.id ?? null),
    impersonating: false,
    realRole,
    error: null,
  }
}
