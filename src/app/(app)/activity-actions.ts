'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'

export async function getActivityLog(entidadTipo: string, entidadId: string, oportunidadId?: string | null) {
  const { supabase, workspaceId, error } = await getWorkspace()
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

  return data ?? []
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

  const { data: log, error: insertError } = await supabase
    .from('activity_log')
    .insert({
      workspace_id: workspaceId,
      entidad_tipo: entidadTipo,
      entidad_id: entidadId,
      tipo: 'comentario',
      autor_id: staffId,
      contenido: contenido.trim(),
      // Se conserva para que el timeline siga mostrando a quién se mencionó.
      // Ya NO es la fuente del aviso: de eso se encarga `activity_menciones`.
      mencion_id: mencionId || staffIds[0] || null,
      link_url: linkUrl?.trim() || null,
    })
    .select('id')
    .single()

  if (insertError) return { error: insertError.message }

  const filas = [
    ...staffIds.map(sid => ({
      workspace_id: workspaceId,
      activity_log_id: (log as { id: string }).id,
      staff_id: sid,
      area: null as string | null,
    })),
    ...areas.map(a => ({
      workspace_id: workspaceId,
      activity_log_id: (log as { id: string }).id,
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
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const { error: deleteError } = await supabase
    .from('activity_log')
    .delete()
    .eq('id', activityId)
    .eq('workspace_id', workspaceId)
    .eq('tipo', 'comentario') // solo comentarios se pueden borrar

  if (deleteError) return { error: deleteError.message }
  return { success: true }
}

/** Log a system change (called from other server actions) */
export async function logSystemChange(
  workspaceId: string,
  entidadTipo: 'oportunidad' | 'proyecto' | 'negocio',
  entidadId: string,
  campo: string,
  valorAnterior: string | null,
  valorNuevo: string | null,
  autorStaffId?: string | null,
  opts?: { tipo?: string; contenido?: string },
) {
  const { supabase, error } = await getWorkspace()
  if (error) return

  await supabase.from('activity_log').insert({
    workspace_id: workspaceId,
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    tipo: opts?.tipo ?? 'cambio',
    autor_id: autorStaffId || null,
    campo_modificado: campo,
    valor_anterior: valorAnterior,
    valor_nuevo: valorNuevo,
    ...(opts?.contenido ? { contenido: opts.contenido } : {}),
  })
}
