'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────

export type Riesgo = {
  id: string
  workspace_id: string
  codigo: string | null
  categoria: 'LA' | 'FT' | 'FPADM' | 'PTEE'
  descripcion: string
  factor_riesgo: string
  probabilidad: number
  impacto: number
  nivel_riesgo: string
  estado: string
  responsable_id: string | null
  fuente_identificacion: string | null
  fecha_identificacion: string | null
  fecha_evaluacion: string | null
  evaluado_por: string | null
  evidencias: unknown[]
  notas: string | null
  created_at: string
  updated_at: string
  // joined fields
  responsable_nombre?: string | null
}

// ── List riesgos ───────────────────────────────────────────

export async function getRiesgos(filters?: {
  categoria?: string
  nivel_riesgo?: string
  estado?: string
  factor_riesgo?: string
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('riesgos')
    .select('*, responsable:profiles!responsable_id(full_name)')
    .eq('workspace_id', workspaceId)

  if (filters?.categoria && filters.categoria !== 'todos') {
    query = query.eq('categoria', filters.categoria)
  }
  if (filters?.nivel_riesgo && filters.nivel_riesgo !== 'todos') {
    query = query.eq('nivel_riesgo', filters.nivel_riesgo)
  }
  if (filters?.estado && filters.estado !== 'todos') {
    query = query.eq('estado', filters.estado)
  }
  if (filters?.factor_riesgo && filters.factor_riesgo !== 'todos') {
    query = query.eq('factor_riesgo', filters.factor_riesgo)
  }

  // Order: CRITICO first, then ALTO, MEDIO, BAJO
  query = query.order('created_at', { ascending: false })

  const { data } = await query

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const riesgos = (data ?? []).map((r: any) => ({
    ...r,
    responsable_nombre: r.responsable?.full_name ?? null,
  }))

  // Sort by nivel: CRITICO > ALTO > MEDIO > BAJO
  const nivelOrder: Record<string, number> = { CRITICO: 0, ALTO: 1, MEDIO: 2, BAJO: 3 }
  riesgos.sort((a: Riesgo, b: Riesgo) => (nivelOrder[a.nivel_riesgo] ?? 4) - (nivelOrder[b.nivel_riesgo] ?? 4))

  return riesgos as Riesgo[]
}

// ── Get single riesgo ──────────────────────────────────────

export async function getRiesgo(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('riesgos')
    .select('*, responsable:profiles!responsable_id(full_name)')
    .eq('id', id)
    .single()

  if (!data) return null

  return {
    ...data,
    responsable_nombre: data.responsable?.full_name ?? null,
  } as Riesgo
}

// ── Create riesgo ──────────────────────────────────────────

export async function crearRiesgo(formData: FormData) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const categoria = formData.get('categoria') as string
  const descripcion = (formData.get('descripcion') as string)?.trim()
  const factor_riesgo = formData.get('factor_riesgo') as string
  const probabilidad = parseInt(formData.get('probabilidad') as string)
  const impacto = parseInt(formData.get('impacto') as string)
  const fuente_identificacion = (formData.get('fuente_identificacion') as string) || null
  const notas = (formData.get('notas') as string)?.trim() || null

  if (!categoria || !descripcion || !factor_riesgo) {
    return { success: false, error: 'Campos requeridos: categoria, descripcion, factor de riesgo' }
  }
  if (isNaN(probabilidad) || probabilidad < 1 || probabilidad > 5) {
    return { success: false, error: 'Probabilidad debe estar entre 1 y 5' }
  }
  if (isNaN(impacto) || impacto < 1 || impacto > 5) {
    return { success: false, error: 'Impacto debe estar entre 1 y 5' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('riesgos')
    .insert({
      workspace_id: workspaceId,
      categoria,
      descripcion,
      factor_riesgo,
      probabilidad,
      impacto,
      fuente_identificacion,
      notas,
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/riesgos')
  revalidatePath('/matriz')
  redirect('/riesgos')
}

// ── Update riesgo ──────────────────────────────────────────

export async function actualizarRiesgo(id: string, formData: FormData) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {}

  const fields = ['estado', 'notas', 'responsable_id', 'fuente_identificacion', 'categoria', 'descripcion', 'factor_riesgo'] as const
  for (const f of fields) {
    const v = formData.get(f) as string | null
    if (v !== null) updates[f] = v.trim() || null
  }

  // Numeric fields
  const prob = formData.get('probabilidad') as string | null
  if (prob !== null) {
    const val = parseInt(prob)
    if (!isNaN(val) && val >= 1 && val <= 5) updates.probabilidad = val
  }
  const imp = formData.get('impacto') as string | null
  if (imp !== null) {
    const val = parseInt(imp)
    if (!isNaN(val) && val >= 1 && val <= 5) updates.impacto = val
  }

  updates.updated_at = new Date().toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('riesgos')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/riesgos')
  revalidatePath(`/riesgos/${id}`)
  revalidatePath('/matriz')
  return { success: true }
}

// ── Delete riesgo ──────────────────────────────────────────

export async function eliminarRiesgo(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('riesgos')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/riesgos')
  revalidatePath('/matriz')
  redirect('/riesgos')
}

// ── Get riesgos_controles for a riesgo ─────────────────────

export async function getControlesRiesgo(riesgoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('riesgos_controles')
    .select('*')
    .eq('riesgo_id', riesgoId)
    .order('created_at', { ascending: false })

  return data ?? []
}

// ── Get team members for responsable selector ──────────────

export async function getEquipoParaRiesgo() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('workspace_id', workspaceId)
    .order('full_name')

  return (data ?? []).map(p => ({
    id: p.id,
    full_name: p.full_name ?? 'Sin nombre',
    role: p.role,
  }))
}
