'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Create gasto (FAB) ──────────────────────────────────────

export async function createGasto(input: {
  monto: number
  categoria: string
  fecha: string
  descripcion?: string
  deducible?: boolean
  proyecto_id?: string | null  // UUID, 'empresa', or null
  rubro_id?: string | null
}) {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  if (!input.monto || input.monto <= 0) return { success: false, error: 'Monto invalido' }

  // Determine tipo and real proyecto_id
  let tipo: string = 'operativo'
  let proyectoId: string | null = null

  if (input.proyecto_id === 'empresa') {
    tipo = 'empresa'
    proyectoId = null
  } else if (input.proyecto_id) {
    // Validate project is en_ejecucion
    const { data: proyecto } = await supabase
      .from('proyectos')
      .select('estado')
      .eq('id', input.proyecto_id)
      .single()

    if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }
    if (proyecto.estado !== 'en_ejecucion') {
      return { success: false, error: 'Solo se pueden registrar gastos en proyectos en ejecución' }
    }

    tipo = 'directo'
    proyectoId = input.proyecto_id
  }

  const { error: dbError } = await supabase
    .from('gastos')
    .insert({
      workspace_id: workspaceId,
      fecha: input.fecha || new Date().toISOString().split('T')[0],
      monto: input.monto,
      categoria: input.categoria || 'otros',
      descripcion: input.descripcion?.trim() || null,
      deducible: input.deducible ?? false,
      proyecto_id: proyectoId,
      rubro_id: (proyectoId && input.rubro_id) ? input.rubro_id : null,
      tipo,
      canal_registro: 'app',
      created_by: userId,
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/numeros')
  if (proyectoId) revalidatePath(`/proyectos/${proyectoId}`)
  return { success: true }
}

// ── Get active projects for gasto selector ───────────────────

export async function getProyectosParaGasto() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('proyectos')
    .select('id, nombre, tipo')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'en_ejecucion')
    .order('nombre')

  return (data ?? []).map(p => ({
    id: p.id,
    nombre: p.nombre ?? 'Sin nombre',
    tipo: p.tipo ?? 'cliente',
  }))
}

// ── Get rubros for a specific project ────────────────────────

export async function getRubrosProyecto(proyectoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('proyecto_rubros')
    .select('id, nombre')
    .eq('proyecto_id', proyectoId)
    .order('created_at')

  return data ?? []
}
