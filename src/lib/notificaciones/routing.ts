import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A quién se le avisa lo que pasa en un negocio.
 *
 * Hasta 2026-07-27 el destinatario se elegía por ROL GLOBAL del workspace: el
 * primer operator de la lista, el primer supervisor, el owner. Nunca se miraba
 * quién lleva el negocio. Medido en SOENA: de 114 avisos pendientes, solo 5
 * habían llegado a alguien responsable de ese caso.
 *
 * El modelo nuevo enruta por el responsable del stage (comercial en venta,
 * operaciones en ejecución, ambos en cobro) vía la función SQL
 * `destinatarios_negocio`. Se activa por workspace para no cambiarle el
 * comportamiento a los que aún no migraron sus responsables a los dos roles.
 */
export type ConfigNotificaciones = {
  routing_por_responsable: boolean
  /** Día a partir del cual el supervisor del área también se entera. */
  escalar_supervisor_dias: number
  /** El owner nunca recibe avisos operativos (puede ser MeTRIK, no el cliente). */
  nunca_owner: boolean
}

const DEFAULTS: ConfigNotificaciones = {
  routing_por_responsable: false,
  escalar_supervisor_dias: 7,
  nunca_owner: false,
}

/**
 * Lee la config del workspace una sola vez por corrida del cron (el loop
 * recorre negocios, no workspaces, y muchos comparten workspace).
 */
export async function getConfigNotificaciones(
  supabase: SupabaseClient,
  workspaceId: string,
  cache: Map<string, ConfigNotificaciones>,
): Promise<ConfigNotificaciones> {
  const cached = cache.get(workspaceId)
  if (cached) return cached

  const { data } = await supabase
    .from('workspaces')
    .select('config_extra')
    .eq('id', workspaceId)
    .maybeSingle()

  const raw = (data?.config_extra as Record<string, unknown> | null)?.notificaciones as
    | Partial<ConfigNotificaciones>
    | undefined

  const cfg: ConfigNotificaciones = {
    routing_por_responsable: raw?.routing_por_responsable === true,
    escalar_supervisor_dias:
      typeof raw?.escalar_supervisor_dias === 'number'
        ? raw.escalar_supervisor_dias
        : DEFAULTS.escalar_supervisor_dias,
    nunca_owner: raw?.nunca_owner === true,
  }

  cache.set(workspaceId, cfg)
  return cfg
}

/** Supervisores de un área concreta del workspace (para el escalamiento). */
export async function supervisoresDeArea(
  supabase: SupabaseClient,
  workspaceId: string,
  area: 'comercial' | 'operaciones' | 'financiera',
): Promise<string[]> {
  const { data } = await supabase
    .from('staff')
    .select('profile_id, staff_areas!inner(area), profiles!inner(role)')
    .eq('workspace_id', workspaceId)
    .eq('staff_areas.area', area)
    .eq('profiles.role', 'supervisor')

  return ((data ?? []) as Array<{ profile_id: string | null }>)
    .map(s => s.profile_id)
    .filter((id): id is string => Boolean(id))
}
