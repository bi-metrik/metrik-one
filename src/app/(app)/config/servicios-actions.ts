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

export async function getServiciosActivos() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('servicios')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('activo', true)
    .order('nombre', { ascending: true })

  return data ?? []
}

export async function createServicio(input: {
  nombre: string
  precio_estandar: number
  rubros_template?: RubroTemplate[]
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
      rubros_template: (input.rubros_template ?? null) as unknown as Json,
      activo: true,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/config')
  return { success: true, id: data.id }
}

export async function updateServicio(id: string, input: {
  nombre?: string
  precio_estandar?: number
  rubros_template?: RubroTemplate[] | null
  activo?: boolean
}) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const updates: Record<string, unknown> = {}
  if (input.nombre !== undefined) updates.nombre = input.nombre.trim()
  if (input.precio_estandar !== undefined) updates.precio_estandar = input.precio_estandar
  if (input.rubros_template !== undefined) updates.rubros_template = input.rubros_template
  if (input.activo !== undefined) updates.activo = input.activo

  const { error: dbError } = await supabase
    .from('servicios')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/config')
  return { success: true }
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
  return { success: true }
}

export async function toggleServicio(id: string, activo: boolean) {
  return updateServicio(id, { activo })
}
