'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import {
  canEditBloque,
  canViewNegocio,
  canAdvanceStage,
  type UserContext,
  type Stage,
  type Role,
  type Area,
} from './can-edit'

/**
 * Guards server-side de negocios. TODA server action que muta bloques/etapas o
 * expone el detalle de un negocio DEBE invocar el guard correspondiente al
 * inicio. getBloqueMode/_areaReadonly (cliente) es solo UX, no es seguridad.
 *
 * UserContext.id = staff.id (negocio_responsables guarda staff.id). El cliente
 * supabase es el del usuario real/impersonado (getWorkspace ya aplica "Ver como").
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(c: unknown): any { return c }

async function resolverCtx() {
  const { supabase, role, staffId, areas, error } = await getWorkspace()
  if (error) return null
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  return { supabase, user }
}

async function responsablesDe(supabase: unknown, negocioId: string): Promise<string[]> {
  const { data } = await db(supabase)
    .from('negocio_responsables')
    .select('staff_id')
    .eq('negocio_id', negocioId)
  return ((data ?? []) as { staff_id: string }[]).map((r) => r.staff_id)
}

/** Guard de edición de un bloque por su id (resuelve negocio + stage + responsables). */
export async function guardEditarBloque(
  negocioBloqueId: string,
): Promise<{ ok: boolean; error?: string }> {
  const c = await resolverCtx()
  if (!c) return { ok: false, error: 'No autenticado' }
  const { data: nb } = await db(c.supabase)
    .from('negocio_bloques')
    .select('negocio_id, bloque_configs!inner(etapas_negocio!inner(stage))')
    .eq('id', negocioBloqueId)
    .single()
  if (!nb) return { ok: false, error: 'Bloque no encontrado' }
  const stage = (nb.bloque_configs?.etapas_negocio?.stage ?? null) as Stage | null
  if (!stage) return { ok: false, error: 'Etapa sin stage' }
  const resp = await responsablesDe(c.supabase, nb.negocio_id as string)
  if (!canEditBloque(c.user, { stage }, resp)) {
    return { ok: false, error: 'Tu rol o área no permite editar en esta fase del negocio' }
  }
  return { ok: true }
}

/** Guard de visibilidad de un negocio (operator solo si es responsable). */
export async function guardVerNegocio(
  negocioId: string,
): Promise<{ ok: boolean; error?: string }> {
  const c = await resolverCtx()
  if (!c) return { ok: false, error: 'No autenticado' }
  const resp = await responsablesDe(c.supabase, negocioId)
  if (!canViewNegocio(c.user, resp)) return { ok: false, error: 'Sin acceso a este negocio' }
  return { ok: true }
}

/** Guard de avance/cambio de etapa al stage destino. */
export async function guardAvanzarStage(
  negocioId: string,
  stageTo: Stage,
): Promise<{ ok: boolean; error?: string }> {
  const c = await resolverCtx()
  if (!c) return { ok: false, error: 'No autenticado' }
  const resp = await responsablesDe(c.supabase, negocioId)
  if (!canAdvanceStage(c.user, stageTo, resp)) {
    return { ok: false, error: 'Tu rol o área no permite avanzar a esta fase' }
  }
  return { ok: true }
}

/** ¿El usuario actual es owner/admin? Para overrides (omitir gate, retroceder). */
export async function esGerencial(): Promise<boolean> {
  const c = await resolverCtx()
  if (!c) return false
  return c.user.role === 'owner' || c.user.role === 'admin'
}
