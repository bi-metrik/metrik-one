'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Tipos ─────────────────────────────────────────────

export type NotificacionTipo =
  | 'inactividad_oportunidad'
  | 'handoff'
  | 'asignacion_responsable'
  | 'asignacion_colaborador'
  | 'mencion'
  | 'streak_roto'
  | 'inactividad_proyecto'
  | 'proyecto_entregado'
  | 'proyecto_cerrado'

export type NotificacionEstado = 'pendiente' | 'completada' | 'descartada'

export type NotificacionItem = {
  id: string
  tipo: NotificacionTipo
  estado: NotificacionEstado
  contenido: string
  entidad_tipo: string | null
  entidad_id: string | null
  deep_link: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ── Obtener notificaciones del usuario actual ─────────

export async function getNotificaciones(): Promise<NotificacionItem[]> {
  const { supabase, userId, error } = await getWorkspace()
  if (error || !userId) return []

  const { data } = await supabase
    .from('notificaciones')
    .select('id, tipo, estado, contenido, entidad_tipo, entidad_id, deep_link, metadata, created_at')
    .eq('destinatario_id', userId)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false })
    .limit(50)

  return (data ?? []) as NotificacionItem[]
}

// ── Marcar una notificación como completada ───────────

export async function marcarCompletada(id: string) {
  const { supabase, userId, error } = await getWorkspace()
  if (error || !userId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('notificaciones')
    .update({ estado: 'completada', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('destinatario_id', userId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/', 'layout')
  return { success: true }
}

// ── Descartar una notificación ────────────────────────

export async function descartarNotificacion(id: string) {
  const { supabase, userId, error } = await getWorkspace()
  if (error || !userId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('notificaciones')
    .update({ estado: 'descartada', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('destinatario_id', userId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/', 'layout')
  return { success: true }
}

// ── Marcar todas como completadas ────────────────────

export async function marcarTodasCompletadas() {
  const { supabase, userId, error } = await getWorkspace()
  if (error || !userId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('notificaciones')
    .update({ estado: 'completada', updated_at: new Date().toISOString() })
    .eq('destinatario_id', userId)
    .eq('estado', 'pendiente')

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/', 'layout')
  return { success: true }
}
