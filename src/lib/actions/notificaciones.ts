'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Tipos ─────────────────────────────────────────────

// Los tipos que el producto conoce y sabe iconizar. NO es exhaustivo por diseño:
// la columna `notificaciones.tipo` es texto libre y los crons/triggers pueden
// escribir tipos que el front todavía no conoce. Por eso `NotificacionItem.tipo`
// es `string` y el render siempre cae a un default — un tipo nuevo en datos
// nunca puede romper la campana.
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
  | 'responsable_faltante_area'
  | 'cobro_vencido'
  | 'cuenta_cobro_pendiente_aprobacion'

export type NotificacionEstado = 'pendiente' | 'completada' | 'descartada'

export type NotificacionItem = {
  id: string
  /** Texto libre en DB. Ver nota en NotificacionTipo: el render nunca asume exhaustividad. */
  tipo: NotificacionTipo | (string & {})
  estado: NotificacionEstado
  contenido: string
  entidad_tipo: string | null
  entidad_id: string | null
  deep_link: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ── Obtener notificaciones del usuario actual ─────────

// Sin `export`: este archivo es 'use server' y ahí solo pueden exportarse
// funciones async (Next falla el build con una constante exportada).
const NOTIFICACIONES_PAGE_SIZE = 50

export type NotificacionesPagina = {
  items: NotificacionItem[]
  /** Total de pendientes del usuario, independiente de cuántas se trajeron. */
  total: number
}

/**
 * Trae una página de pendientes MÁS el total real.
 *
 * Antes devolvía un array topado en 50 sin decirlo: quien tenía 68 pendientes
 * veía 50 (las más recientes) y perdía de vista las 18 más viejas — que suelen
 * ser las urgentes. El badge tampoco podía ser honesto, contaba solo lo cargado.
 */
export async function getNotificaciones(offset = 0): Promise<NotificacionesPagina> {
  const { supabase, userId, error } = await getWorkspace()
  if (error || !userId) return { items: [], total: 0 }

  const { data, count } = await supabase
    .from('notificaciones')
    .select('id, tipo, estado, contenido, entidad_tipo, entidad_id, deep_link, metadata, created_at', {
      count: 'exact',
    })
    .eq('destinatario_id', userId)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false })
    .range(offset, offset + NOTIFICACIONES_PAGE_SIZE - 1)

  return { items: (data ?? []) as NotificacionItem[], total: count ?? 0 }
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
