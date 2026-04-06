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

export async function addComment(
  entidadTipo: string,
  entidadId: string,
  contenido: string,
  mencionId?: string | null,
  linkUrl?: string | null,
) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  if (!staffId) return { error: 'No tienes perfil de staff' }
  if (!contenido.trim() || contenido.length > 280) return { error: 'Contenido invalido (max 280 chars)' }

  const { error: insertError } = await supabase.from('activity_log').insert({
    workspace_id: workspaceId,
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    tipo: 'comentario',
    autor_id: staffId,
    contenido: contenido.trim(),
    mencion_id: mencionId || null,
    link_url: linkUrl?.trim() || null,
  })

  if (insertError) return { error: insertError.message }
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
