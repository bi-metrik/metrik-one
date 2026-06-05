'use server'

/**
 * Server actions del modulo equipo multi-area (Superficie 1 spec UX 2026-05-20).
 *
 * Cubre:
 *   - getEquipoConAreas(): staff con areas[] + count negocios activos
 *   - getWorkspaceDefaultResponsables(): map area → staff_id
 *   - updateStaffAreas(staffId, areas[])
 *   - setWorkspaceDefaultResponsable(area, staffId | null)
 *
 * Las migraciones de tablas y triggers viven en
 *   supabase/migrations/20260520000001_staff_areas.sql
 *   supabase/migrations/20260520000007_workspace_default_responsables.sql
 *
 * Reglas:
 *   - operator/supervisor/admin/owner requieren al menos 1 area (regla 14a)
 *   - contador/read_only fuera del modelo de areas
 *   - direccion expande a las 3 areas operativas (helper getAreasEfectivas)
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from './get-workspace'
import type { Area, Role } from '@/lib/permissions/can-edit'
import { ALL_AREAS, roleRequiresAreas } from '@/lib/permissions/areas'

// ── Tipos ────────────────────────────────────────────────────────────

export interface StaffConAreas {
  id: string
  full_name: string
  rol_plataforma: string | null
  role: Role | null
  areas: Area[]
  negocios_activos_count: number
  is_active: boolean
  profile_id: string | null
}

export interface DefaultResponsableMap {
  comercial: { staff_id: string; full_name: string } | null
  operaciones: { staff_id: string; full_name: string } | null
  financiera: { staff_id: string; full_name: string } | null
}

// ── Helpers internos ─────────────────────────────────────────────────

function isArea(v: unknown): v is Area {
  return typeof v === 'string' && (ALL_AREAS as readonly string[]).includes(v)
}

function uniqueAreas(input: Area[]): Area[] {
  return Array.from(new Set(input)).filter(isArea)
}

// ── getEquipoConAreas ────────────────────────────────────────────────

export async function getEquipoConAreas(): Promise<StaffConAreas[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // Staff base
  const { data: staffRows } = await supabase
    .from('staff')
    .select('id, full_name, rol_plataforma, is_active, profile_id')
    .eq('workspace_id', workspaceId)
    .order('full_name')

  if (!staffRows || staffRows.length === 0) return []

  const staffIds = staffRows.map((s) => s.id as string)

  // Areas asignadas en staff_areas (tabla nueva Fase 1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: areasRows } = await (supabase as any)
    .from('staff_areas')
    .select('staff_id, area')
    .in('staff_id', staffIds)

  const areasByStaff = new Map<string, Area[]>()
  for (const row of (areasRows ?? []) as Array<{ staff_id: string; area: string }>) {
    if (!isArea(row.area)) continue
    const list = areasByStaff.get(row.staff_id) ?? []
    list.push(row.area)
    areasByStaff.set(row.staff_id, list)
  }

  // Roles desde profiles (cuando staff esta vinculado)
  const profileIds = staffRows
    .map((s) => s.profile_id as string | null)
    .filter((p): p is string => Boolean(p))

  const profileRoleMap = new Map<string, Role>()
  if (profileIds.length > 0) {
    const { data: profilesRows } = await supabase
      .from('profiles')
      .select('id, role')
      .in('id', profileIds)
    for (const p of (profilesRows ?? []) as Array<{ id: string; role: string | null }>) {
      if (p.role) profileRoleMap.set(p.id, p.role as Role)
    }
  }

  // Conteo de negocios activos por responsable (via negocio_responsables)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: respRows } = await (supabase as any)
    .from('negocio_responsables')
    .select('staff_id, negocio_id, negocios!inner(estado, workspace_id)')
    .in('staff_id', staffIds)
    .eq('negocios.workspace_id', workspaceId)
    .eq('negocios.estado', 'abierto')

  const countByStaff = new Map<string, number>()
  for (const row of (respRows ?? []) as Array<{ staff_id: string }>) {
    countByStaff.set(row.staff_id, (countByStaff.get(row.staff_id) ?? 0) + 1)
  }

  return staffRows.map((s) => {
    const profileId = s.profile_id as string | null
    return {
      id: s.id as string,
      full_name: (s.full_name as string | null) ?? 'Sin nombre',
      rol_plataforma: (s.rol_plataforma as string | null) ?? null,
      role: profileId ? profileRoleMap.get(profileId) ?? null : null,
      areas: areasByStaff.get(s.id as string) ?? [],
      negocios_activos_count: countByStaff.get(s.id as string) ?? 0,
      is_active: Boolean(s.is_active),
      profile_id: profileId,
    }
  })
}

// ── getWorkspaceDefaultResponsables ──────────────────────────────────

export async function getWorkspaceDefaultResponsables(): Promise<DefaultResponsableMap> {
  const empty: DefaultResponsableMap = {
    comercial: null,
    operaciones: null,
    financiera: null,
  }
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return empty

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('workspace_default_responsables')
    .select('area, staff_id, staff:staff_id(full_name)')
    .eq('workspace_id', workspaceId)

  const out: DefaultResponsableMap = { ...empty }
  for (const row of (rows ?? []) as Array<{
    area: string
    staff_id: string
    staff: { full_name: string | null } | null
  }>) {
    if (row.area === 'comercial' || row.area === 'operaciones' || row.area === 'financiera') {
      out[row.area] = {
        staff_id: row.staff_id,
        full_name: row.staff?.full_name ?? 'Sin nombre',
      }
    }
  }
  return out
}

// ── updateStaffAreas ─────────────────────────────────────────────────

export async function updateStaffAreas(
  staffId: string,
  areas: Area[],
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) {
    return { ok: false, error: 'No autenticado' }
  }

  // Permiso: gestionar areas del equipo es decision organizacional -> owner/admin.
  // (2026-06-04: el supervisor deja de configurar areas al unificar en "Mi equipo").
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Sin permisos para editar areas' }
  }

  // Validar staff pertenece al workspace + obtener rol
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id, profile_id')
    .eq('id', staffId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!staffRow) return { ok: false, error: 'Staff no encontrado' }

  // Validar regla 14a — roles que requieren area
  const profileId = (staffRow as { profile_id?: string }).profile_id
  let staffRole: Role | null = null
  if (profileId) {
    const { data: p } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', profileId)
      .maybeSingle()
    staffRole = ((p as { role?: string } | null)?.role as Role | undefined) ?? null
  }

  const cleanAreas = uniqueAreas(areas)
  if (staffRole && roleRequiresAreas(staffRole) && cleanAreas.length === 0) {
    return {
      ok: false,
      error: `El rol ${staffRole} requiere al menos un area asignada.`,
    }
  }

  // Reemplazo atomico: DELETE + INSERT
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: delErr } = await (supabase as any)
    .from('staff_areas')
    .delete()
    .eq('staff_id', staffId)
  if (delErr) return { ok: false, error: delErr.message }

  if (cleanAreas.length > 0) {
    const inserts = cleanAreas.map((a) => ({
      staff_id: staffId,
      area: a,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (supabase as any)
      .from('staff_areas')
      .insert(inserts)
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath('/mi-negocio')
  revalidatePath('/mi-negocio/equipo')
  return { ok: true }
}

// ── setWorkspaceDefaultResponsable ───────────────────────────────────

export async function setWorkspaceDefaultResponsable(
  area: Area,
  staffId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }

  // direccion no aplica como default — solo areas operativas
  if (area === 'direccion') {
    return { ok: false, error: 'Direccion no es area operativa con default' }
  }

  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Sin permisos para editar defaults' }
  }

  if (staffId === null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: delErr } = await (supabase as any)
      .from('workspace_default_responsables')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('area', area)
    if (delErr) return { ok: false, error: delErr.message }
  } else {
    // Validar staff pertenece al workspace y tiene esa area (o direccion)
    const { data: staffRow } = await supabase
      .from('staff')
      .select('id')
      .eq('id', staffId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!staffRow) return { ok: false, error: 'Staff no encontrado' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: areaRows } = await (supabase as any)
      .from('staff_areas')
      .select('area')
      .eq('staff_id', staffId)
    const areasStaff = ((areaRows ?? []) as Array<{ area: string }>).map((r) => r.area)
    if (!areasStaff.includes(area) && !areasStaff.includes('direccion')) {
      return {
        ok: false,
        error: `El staff no tiene area ${area} ni direccion.`,
      }
    }

    // Upsert (workspace_id, area) unique
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('workspace_default_responsables')
      .upsert(
        { workspace_id: workspaceId, area, staff_id: staffId },
        { onConflict: 'workspace_id,area' },
      )
    if (upErr) return { ok: false, error: upErr.message }
  }

  revalidatePath('/mi-negocio')
  revalidatePath('/mi-negocio/equipo')
  return { ok: true }
}
