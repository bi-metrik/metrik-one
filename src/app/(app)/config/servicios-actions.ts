'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import type { Json } from '@/types/database'

export interface RubroTemplate {
  tipo: string
  descripcion?: string
  cantidad: number
  unidad: string
  valor_unitario: number
  staff_id?: string
}

// ── CRUD Servicios ────────────────────────────────────────

export async function getServicios() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('servicios')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('nombre', { ascending: true })

  return data ?? []
}

export async function getServiciosActivos(lineaId?: string | null) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('servicios')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('activo', true)

  // Si llega lineaId: muestra servicios de esa linea + globales (linea_id NULL)
  // Si no llega: muestra todos (backwards compat)
  if (lineaId) {
    query = query.or(`linea_id.eq.${lineaId},linea_id.is.null`)
  }

  const { data } = await query.order('nombre', { ascending: true })
  return data ?? []
}

// Helper para selectores UI de lineas en form de servicio
export async function getLineasNegocioWorkspace() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []
  const { data } = await supabase
    .from('lineas_negocio')
    .select('id, nombre')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('nombre', { ascending: true })
  return data ?? []
}

export async function createServicio(input: {
  nombre: string
  precio_estandar: number
  costo_estimado?: number
  rubros_template?: RubroTemplate[]
  linea_id?: string | null
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  if (!input.nombre?.trim()) return { success: false, error: 'Nombre requerido' }

  const { data, error: dbError } = await supabase
    .from('servicios')
    .insert({
      workspace_id: workspaceId,
      nombre: input.nombre.trim(),
      precio_estandar: input.precio_estandar,
      costo_estimado: input.costo_estimado ?? 0,
      rubros_template: (input.rubros_template ?? null) as unknown as Json,
      linea_id: input.linea_id ?? null,
      activo: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .select('*')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true, id: data.id, servicio: data }
}

export async function updateServicio(id: string, input: {
  nombre?: string
  precio_estandar?: number
  costo_estimado?: number
  rubros_template?: RubroTemplate[] | null
  activo?: boolean
  linea_id?: string | null
}) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const updates: Record<string, unknown> = {}
  if (input.nombre !== undefined) updates.nombre = input.nombre.trim()
  if (input.precio_estandar !== undefined) updates.precio_estandar = input.precio_estandar
  if (input.costo_estimado !== undefined) updates.costo_estimado = input.costo_estimado
  if (input.rubros_template !== undefined) updates.rubros_template = input.rubros_template
  if (input.activo !== undefined) updates.activo = input.activo
  if (input.linea_id !== undefined) updates.linea_id = input.linea_id

  const { data, error: dbError } = await supabase
    .from('servicios')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true, servicio: data }
}

export async function deleteServicio(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('servicios')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

export async function toggleServicio(id: string, activo: boolean) {
  return updateServicio(id, { activo })
}
