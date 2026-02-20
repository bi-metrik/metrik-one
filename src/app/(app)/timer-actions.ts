'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Types ─────────────────────────────────────────────────

export interface ActiveTimer {
  id: string
  proyecto_id: string
  proyecto_nombre: string
  inicio: string
  descripcion: string | null
}

// ── Start Timer ───────────────────────────────────────────

export async function startTimer(proyectoId: string, descripcion?: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Validate project is in execution
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('id, nombre, estado')
    .eq('id', proyectoId)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }
  if (proyecto.estado !== 'en_ejecucion') return { success: false, error: 'El proyecto no esta en ejecucion' }

  // Stop any existing timer first (delete old, but don't create horas — they lose that time)
  await supabase
    .from('timer_activo')
    .delete()
    .eq('workspace_id', workspaceId)

  // Insert new timer
  const { data: timer, error: insertError } = await supabase
    .from('timer_activo')
    .insert({
      workspace_id: workspaceId,
      proyecto_id: proyectoId,
      inicio: new Date().toISOString(),
      descripcion: descripcion?.trim() || null,
    })
    .select('id, proyecto_id, inicio, descripcion')
    .single()

  if (insertError) return { success: false, error: insertError.message }

  revalidatePath('/proyectos')
  return {
    success: true,
    timer: {
      id: timer.id,
      proyecto_id: timer.proyecto_id,
      proyecto_nombre: proyecto.nombre ?? 'Sin nombre',
      inicio: timer.inicio,
      descripcion: timer.descripcion,
    } as ActiveTimer,
  }
}

// ── Stop Timer ────────────────────────────────────────────

export async function stopTimer() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get active timer
  const { data: timer } = await supabase
    .from('timer_activo')
    .select('id, proyecto_id, inicio, descripcion')
    .eq('workspace_id', workspaceId)
    .single()

  if (!timer) return { success: false, error: 'No hay timer activo' }

  // Calculate elapsed
  const inicio = new Date(timer.inicio)
  const fin = new Date()
  const elapsedMs = fin.getTime() - inicio.getTime()
  const elapsedHours = Math.round((elapsedMs / 3600000) * 100) / 100 // 2 decimals

  if (elapsedHours < 0.02) { // less than ~1 minute
    // Just delete the timer, don't record
    await supabase
      .from('timer_activo')
      .delete()
      .eq('id', timer.id)

    revalidatePath('/proyectos')
    return { success: true, horasRegistradas: 0, descartado: true }
  }

  // Insert horas record
  const { error: horasError } = await supabase
    .from('horas')
    .insert({
      workspace_id: workspaceId,
      proyecto_id: timer.proyecto_id,
      fecha: new Date().toISOString().split('T')[0],
      horas: elapsedHours,
      descripcion: timer.descripcion || null,
      inicio: timer.inicio,
      fin: fin.toISOString(),
      timer_activo: true,
      canal_registro: 'app',
    })

  if (horasError) return { success: false, error: horasError.message }

  // Delete timer
  await supabase
    .from('timer_activo')
    .delete()
    .eq('id', timer.id)

  revalidatePath('/proyectos')
  return { success: true, horasRegistradas: elapsedHours }
}

// ── Get Active Timer ──────────────────────────────────────

export async function getActiveTimer(): Promise<ActiveTimer | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const { data } = await supabase
    .from('timer_activo')
    .select('id, proyecto_id, inicio, descripcion, proyectos(nombre)')
    .eq('workspace_id', workspaceId)
    .single()

  if (!data) return null

  return {
    id: data.id,
    proyecto_id: data.proyecto_id,
    proyecto_nombre: (data.proyectos as unknown as { nombre: string })?.nombre ?? 'Sin nombre',
    inicio: data.inicio,
    descripcion: data.descripcion,
  }
}

// ── Get Active Projects (for timer selector) ──────────────

export async function getProyectosActivos() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('proyectos')
    .select('id, nombre')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'en_ejecucion')
    .order('nombre')

  return (data ?? []).map(p => ({ id: p.id, name: p.nombre ?? 'Sin nombre' }))
}
