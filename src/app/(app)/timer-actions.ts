'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Types ─────────────────────────────────────────────────

export interface ActiveTimer {
  id: string
  proyecto_id: string | null
  negocio_id: string | null
  proyecto_nombre: string
  inicio: string
  descripcion: string | null
}

// ── Start Timer ───────────────────────────────────────────

export async function startTimer(
  destinoId: string,
  destinoTipo: 'negocio' | 'proyecto' = 'negocio',
  descripcion?: string,
) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  let destinoNombre = 'Sin nombre'

  if (destinoTipo === 'negocio') {
    // Validate negocio is active — negocios not in database.ts types yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: negocio } = await (supabase as any)
      .from('negocios')
      .select('id, nombre, estado')
      .eq('id', destinoId)
      .single()

    if (!negocio) return { success: false, error: 'Negocio no encontrado' }
    if (negocio.estado === 'completado') return { success: false, error: 'El negocio está completado' }
    destinoNombre = negocio.nombre ?? 'Sin nombre'
  } else {
    // Validate project is in execution
    const { data: proyecto } = await supabase
      .from('proyectos')
      .select('id, nombre, estado')
      .eq('id', destinoId)
      .single()

    if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }
    if (proyecto.estado !== 'en_ejecucion') return { success: false, error: 'El proyecto no esta en ejecucion' }
    destinoNombre = proyecto.nombre ?? 'Sin nombre'
  }

  // Stop any existing timer first (delete old, but don't create horas — they lose that time)
  await supabase
    .from('timer_activo')
    .delete()
    .eq('workspace_id', workspaceId)

  // Insert new timer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertPayload: Record<string, any> = {
    workspace_id: workspaceId,
    inicio: new Date().toISOString(),
    descripcion: descripcion?.trim() || null,
    proyecto_id: destinoTipo === 'proyecto' ? destinoId : null,
    negocio_id: destinoTipo === 'negocio' ? destinoId : null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: timer, error: insertError } = await (supabase as any)
    .from('timer_activo')
    .insert(insertPayload)
    .select('id, proyecto_id, negocio_id, inicio, descripcion')
    .single()

  if (insertError) return { success: false, error: insertError.message }

  revalidatePath('/proyectos')
  revalidatePath('/negocios')
  return {
    success: true,
    timer: {
      id: timer.id,
      proyecto_id: timer.proyecto_id ?? null,
      negocio_id: timer.negocio_id ?? null,
      proyecto_nombre: destinoNombre,
      inicio: timer.inicio,
      descripcion: timer.descripcion,
    } as ActiveTimer,
  }
}

// ── Stop Timer ────────────────────────────────────────────

export async function stopTimer() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get active timer (including negocio_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: timer } = await (supabase as any)
    .from('timer_activo')
    .select('id, proyecto_id, negocio_id, inicio, descripcion')
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
    if (timer.negocio_id) revalidatePath('/negocios')
    return { success: true, horasRegistradas: 0, descartado: true }
  }

  // Get principal staff for cost attribution
  const { data: principalStaff } = await supabase
    .from('staff')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('es_principal', true)
    .eq('is_active', true)
    .limit(1)
    .single()

  // Insert horas record with negocio_id and/or proyecto_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const horasPayload: Record<string, any> = {
    workspace_id: workspaceId,
    proyecto_id: timer.proyecto_id ?? null,
    negocio_id: timer.negocio_id ?? null,
    fecha: new Date().toISOString().split('T')[0],
    horas: elapsedHours,
    descripcion: timer.descripcion || null,
    inicio: timer.inicio,
    fin: fin.toISOString(),
    timer_activo: true,
    canal_registro: 'app',
    staff_id: principalStaff?.id ?? null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: horasError } = await (supabase as any)
    .from('horas')
    .insert(horasPayload)

  if (horasError) return { success: false, error: horasError.message }

  // Delete timer
  await supabase
    .from('timer_activo')
    .delete()
    .eq('id', timer.id)

  revalidatePath('/proyectos')
  if (timer.negocio_id) revalidatePath('/negocios')
  return { success: true, horasRegistradas: elapsedHours }
}

// ── Get Active Timer ──────────────────────────────────────

export async function getActiveTimer(): Promise<ActiveTimer | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('timer_activo')
    .select('id, proyecto_id, negocio_id, inicio, descripcion')
    .eq('workspace_id', workspaceId)
    .single()

  if (!data) return null

  // Resolve name: try proyecto first, then negocio
  let nombre = 'Sin nombre'

  if (data.proyecto_id) {
    const { data: proyecto } = await supabase
      .from('proyectos')
      .select('nombre')
      .eq('id', data.proyecto_id)
      .single()
    nombre = proyecto?.nombre ?? 'Sin nombre'
  } else if (data.negocio_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: negocio } = await (supabase as any)
      .from('negocios')
      .select('nombre')
      .eq('id', data.negocio_id)
      .single()
    nombre = negocio?.nombre ?? 'Sin nombre'
  }

  return {
    id: data.id,
    proyecto_id: data.proyecto_id ?? null,
    negocio_id: data.negocio_id ?? null,
    proyecto_nombre: nombre,
    inicio: data.inicio,
    descripcion: data.descripcion,
  }
}

// ── Get Destinos for Timer (negocios + proyectos) ─────────

export async function getDestinosParaTimer() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { negocios: [], proyectos: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('negocios')
    .select('id, nombre, codigo')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')
    .order('nombre')

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    negocios: (data ?? []).map((n: any) => ({ id: n.id, name: n.nombre ?? 'Sin nombre', code: n.codigo ?? '' })),
    proyectos: [],
  }
}

// ── Deprecated: backwards compat wrapper ──────────────────

/** @deprecated Use getDestinosParaTimer() instead */
export async function getProyectosActivos() {
  const destinos = await getDestinosParaTimer()
  return destinos.proyectos
}
