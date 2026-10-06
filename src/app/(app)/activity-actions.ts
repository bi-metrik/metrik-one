'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
// Solo el tipo, e **importado** — nunca re-exportado. En un archivo `'use server'` un
// `export type { X }` de un símbolo importado revienta en producción y no en dev
// (ver el gotcha del PR #452 en CLAUDE.md).
import type { ActivityLogTipo } from '@/lib/activity/tipos'
import { puedeBorrarEntrada } from '@/lib/activity/borrar-comentario'

export async function getActivityLog(entidadTipo: string, entidadId: string, oportunidadId?: string | null) {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // Si hay oportunidad vinculada, traer el log de ambas entidades
  const ids = [entidadId, ...(oportunidadId ? [oportunidadId] : [])]

  const { data } = await supabase
    .from('activity_log')
    .select('*, autor:staff!activity_log_autor_id_fkey(id, full_name), mencion:staff!activity_log_mencion_id_fkey(id, full_name)')
    .eq('workspace_id', workspaceId)
    .in('entidad_id', ids)
    .order('created_at', { ascending: false })
    .limit(50)

  const entradas = data ?? []
  const menciones = await mencionesDe(supabase, workspaceId, entradas.filter(e => e.tipo === 'comentario').map(e => e.id))

  // `puede_borrar` lo decide la misma regla que aplica `deleteActivity`: la pantalla
  // solo dibuja el botón donde el servidor va a dejar borrar.
  return entradas.map(e => ({
    ...e,
    menciones: menciones.get(e.id) ?? [],
    puede_borrar: puedeBorrarEntrada(e, { staffId, role }),
  }))
}

/**
 * A quién se mencionó en cada comentario: personas por nombre y equipos como `@area`.
 *
 * Es lectura aparte, no un embed del select principal: si fallara, el timeline se
 * muestra igual (sin los distintivos) en vez de quedar vacío.
 */
async function mencionesDe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  ids: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (ids.length === 0) return out
  const { data, error } = await supabase
    .from('activity_menciones')
    .select('activity_log_id, area, persona:staff(full_name)')
    .eq('workspace_id', workspaceId)
    .in('activity_log_id', ids)
  if (error) {
    console.error('[getActivityLog] no se pudieron leer las menciones:', error.message)
    return out
  }
  for (const m of (data ?? []) as Array<{ activity_log_id: string; area: string | null; persona: { full_name: string | null } | null }>) {
    const etiqueta = m.area ? `@${m.area}` : m.persona?.full_name
    if (!etiqueta) continue
    out.set(m.activity_log_id, [...(out.get(m.activity_log_id) ?? []), etiqueta])
  }
  return out
}

/** Equipos que se pueden etiquetar en un comentario. */
export type AreaMencionable = 'comercial' | 'operaciones' | 'financiera'

export async function addComment(
  entidadTipo: string,
  entidadId: string,
  contenido: string,
  mencionId?: string | null,
  linkUrl?: string | null,
  /**
   * Menciones del comentario. Personas y/o equipos.
   *
   * Antes solo cabía UNA persona (`mencion_id`), así que pedirle algo a tres
   * personas obligaba a escribir el mismo comentario tres veces. Etiquetar a un
   * equipo (@operaciones) crea un pendiente compartido: le llega a todos sus
   * miembros y basta con que uno lo atienda.
   */
  menciones?: { staffIds?: string[]; areas?: AreaMencionable[] },
) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  if (!staffId) return { error: 'No tienes perfil de staff' }
  if (!contenido.trim() || contenido.length > 280) return { error: 'Contenido invalido (max 280 chars)' }

  const staffIds = [...new Set(menciones?.staffIds ?? [])]
  const areas = [...new Set(menciones?.areas ?? [])]

  const log = await registrarActividad(supabase, {
    workspace_id: workspaceId,
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    tipo: 'comentario',
    autor_id: staffId,
    contenido: contenido.trim(),
    // ⚠️ Con menciones nuevas va NULL. `mencion_id` dispara su propio trigger
    // (`trg_notif_mencion`) en ESTE insert, antes de que existan las filas de
    // `activity_menciones` que su guarda busca, y la persona recibía el aviso dos
    // veces (72 pares a 0,2 s, medido el 2026-10-06). El distintivo del timeline
    // ahora sale de `activity_menciones` (ver `getActivityLog`). Solo el camino
    // legado (un `mencionId` suelto, sin la lista) lo sigue escribiendo.
    mencion_id: staffIds.length > 0 || areas.length > 0 ? null : (mencionId || null),
    link_url: linkUrl?.trim() || null,
  }, 'addComment')

  // Aquí sí se corta: el comentario ES la operación, no su rastro. Si no entró, no
  // hay nada que reportarle al usuario como guardado.
  if (!log.ok) return { error: log.motivo }
  if (!log.id) return { error: 'El comentario no devolvió identificador' }
  const logId = log.id

  const filas = [
    ...staffIds.map(sid => ({
      workspace_id: workspaceId,
      activity_log_id: logId,
      staff_id: sid,
      area: null as string | null,
    })),
    ...areas.map(a => ({
      workspace_id: workspaceId,
      activity_log_id: logId,
      staff_id: null as string | null,
      area: a,
    })),
  ]

  if (filas.length > 0) {
    // El trigger de `activity_menciones` crea los avisos (persona = personal,
    // área = pendiente de equipo). Si esto falla, el comentario ya quedó
    // guardado: se reporta pero no se revierte el texto que la persona escribió.
    // Cast puntual: tabla nueva, `database.ts` sin regenerar (mismo patrón que
    // kyc_expediente_ref / drive-health en el repo).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: mencionError } = await (supabase as any).from('activity_menciones').insert(filas)
    if (mencionError) {
      console.error('[addComment] no se pudieron registrar las menciones:', mencionError.message)
      return { success: true, warning: 'El comentario se guardó, pero no se pudo avisar a los mencionados.' }
    }
  }

  return { success: true }
}

export async function deleteActivity(activityId: string) {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Se lee antes de borrar: el DELETE por PostgREST no dice POR QUÉ no borró, y la
  // regla (autor u owner/admin, solo comentarios) necesita la fila.
  const { data: entrada, error: lecturaError } = await supabase
    .from('activity_log')
    .select('id, tipo, autor_id')
    .eq('id', activityId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (lecturaError) return { error: lecturaError.message }
  if (!entrada) return { error: 'La entrada no existe' }
  if (entrada.tipo !== 'comentario') return { error: 'Solo se pueden borrar comentarios' }
  if (!puedeBorrarEntrada(entrada, { staffId, role })) {
    return { error: 'Solo quien escribió el comentario o un administrador puede borrarlo' }
  }

  const { data: borradas, error: deleteError } = await supabase
    .from('activity_log')
    .delete()
    .eq('id', activityId)
    .eq('workspace_id', workspaceId)
    .eq('tipo', 'comentario')
    .select('id')

  if (deleteError) return { error: deleteError.message }
  // Cero filas sin error es un borrado que no ocurrió: no se anuncia como hecho.
  if (!borradas || borradas.length === 0) return { error: 'No se pudo borrar el comentario' }
  return { success: true }
}

/**
 * Registra un cambio del sistema. La invocan otras server actions.
 *
 * `opts.tipo` estaba tipado como `string`, o sea que cualquier llamador podía pedir
 * un tipo que el CHECK rechaza y el insert se perdía sin ruido. Ahora está acotado al
 * catálogo (`ActivityLogTipo`): un valor inventado no compila.
 */
export async function logSystemChange(
  workspaceId: string,
  entidadTipo: 'oportunidad' | 'proyecto' | 'negocio',
  entidadId: string,
  campo: string,
  valorAnterior: string | null,
  valorNuevo: string | null,
  autorStaffId?: string | null,
  opts?: { tipo?: ActivityLogTipo; contenido?: string },
) {
  const { supabase, error } = await getWorkspace()
  if (error) return

  await registrarActividad(supabase, {
    workspace_id: workspaceId,
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    tipo: opts?.tipo ?? 'cambio',
    autor_id: autorStaffId || null,
    campo_modificado: campo,
    valor_anterior: valorAnterior,
    valor_nuevo: valorNuevo,
    ...(opts?.contenido ? { contenido: opts.contenido } : {}),
  }, 'logSystemChange')
}
