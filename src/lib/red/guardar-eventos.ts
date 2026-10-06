import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { EventoRed } from './eventos'

/**
 * Persiste los eventos del piloto de red en `public.red_eventos` (migración
 * `20261006121500_red_eventos_piloto.sql`). Lo llama `/api/red/eventos` DESPUÉS de responder,
 * con service_role: la tabla es server-only.
 *
 * Idempotente: la llave es el `id` del evento y el reenvío de la bandeja se ignora
 * (`ignoreDuplicates`). Nunca lanza: si la escritura falla, queda la línea `[red-piloto]` del log.
 */

export interface ContextoLote {
  workspaceId: string
  personaStaffId: string | null
  operador: string | null
  asn: number | null
  ciudad?: string
  region?: string
  dispositivo?: string
}

export interface FilaRedEvento {
  id: string
  workspace_id: string
  persona_staff_id: string | null
  tipo: EventoRed['tipo']
  superficie: string | null
  ocurrido_at: string
  dur_ms: number | null
  operador: string | null
  asn: number | null
  ciudad: string | null
  region: string | null
  dispositivo: string | null
  sw: boolean | null
  detalle: Json
}

function ocurrido(e: EventoRed): number {
  return e.tipo === 'pulso' ? e.t1 : e.tipo === 'corte' ? e.inicio : e.t
}

export function filasDeEventos(ctx: ContextoLote, eventos: EventoRed[]): FilaRedEvento[] {
  return eventos.map((e) => {
    const { id, tipo, ...detalle } = e
    return {
      id,
      workspace_id: ctx.workspaceId,
      persona_staff_id: ctx.personaStaffId,
      tipo,
      superficie: e.tipo === 'falla' ? e.superficie : null,
      ocurrido_at: new Date(ocurrido(e)).toISOString(),
      dur_ms: e.tipo === 'pulso' ? null : typeof e.dur_ms === 'number' ? Math.round(e.dur_ms) : null,
      operador: ctx.operador,
      asn: ctx.asn,
      ciudad: ctx.ciudad ?? null,
      region: ctx.region ?? null,
      dispositivo: ctx.dispositivo ?? null,
      sw: typeof e.sw === 'boolean' ? e.sw : null,
      detalle: detalle as unknown as Json,
    }
  })
}

const idsDeWorkspace = new Map<string, string>()

/** El id del workspace por slug, una vez por instancia. */
export async function workspaceIdDeSlug(svc: SupabaseClient<Database>, slug: string): Promise<string | null> {
  const enCache = idsDeWorkspace.get(slug)
  if (enCache) return enCache
  const { data } = await svc.from('workspaces').select('id').eq('slug', slug).maybeSingle()
  const id = (data as { id?: string } | null)?.id ?? null
  if (id) idsDeWorkspace.set(slug, id)
  return id
}

export async function guardarEventosRed(svc: SupabaseClient<Database>, ctx: ContextoLote, eventos: EventoRed[]): Promise<boolean> {
  if (eventos.length === 0) return true
  try {
    const { error } = await svc
      .from('red_eventos')
      .upsert(filasDeEventos(ctx, eventos), { onConflict: 'id', ignoreDuplicates: true })
    if (error) {
      console.error('[red-piloto] no se guardaron los eventos:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('[red-piloto] no se guardaron los eventos:', e instanceof Error ? e.message : e)
    return false
  }
}
