'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

type EntidadWorkflow = 'oportunidad' | 'proyecto'

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkspaceStage {
  id: string
  nombre: string
  slug: string
  color: string
  orden: number
  es_sistema: boolean
  sistema_slug: string | null
  es_terminal: boolean
  activo: boolean
}

export interface TransitionRule {
  id: string
  entidad: EntidadWorkflow
  desde_stage_id: string | null
  hasta_stage_id: string
  tipo: string
  condicion_tipo: string | null
  condicion_config: Record<string, unknown>
  activo: boolean
  desde_stage?: WorkspaceStage | null
  hasta_stage?: WorkspaceStage | null
}

export interface CreateStageInput {
  entidad: EntidadWorkflow
  nombre: string
  color: string
  insertarDespuesDeId: string | null // ID del stage después del cual insertar
}

export interface CreateRuleInput {
  entidad: EntidadWorkflow
  desde_stage_id: string | null
  hasta_stage_id: string
  condicion_tipo: 'all_required_fields' | 'checklist_complete' | 'custom_field_value'
  condicion_config: Record<string, unknown>
}

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

// ── Server Actions ─────────────────────────────────────────────────────────

/** Listar etapas del workspace para una entidad */
export async function getWorkspaceStages(entidad: EntidadWorkflow): Promise<WorkspaceStage[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('workspace_stages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('entidad', entidad)
    .eq('activo', true)
    .order('orden', { ascending: true })

  return (data ?? []) as WorkspaceStage[]
}

/** Crear etapa custom (nunca es_sistema) */
export async function createCustomStage(input: CreateStageInput) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autorizado' }
  if (role !== 'owner') return { error: 'Solo el dueño puede gestionar etapas' }

  const nombre = input.nombre.trim()
  if (!nombre) return { error: 'Nombre requerido' }

  // Obtener etapas actuales para calcular orden
  const { data: stages } = await supabase
    .from('workspace_stages')
    .select('id, orden, es_sistema')
    .eq('workspace_id', workspaceId)
    .eq('entidad', input.entidad)
    .eq('activo', true)
    .order('orden', { ascending: true })

  const stagesArr = stages ?? []

  let nuevoOrden: number

  if (input.insertarDespuesDeId) {
    const refStage = stagesArr.find(s => s.id === input.insertarDespuesDeId)
    if (refStage) {
      // Insertar después del stage de referencia
      const siguiente = stagesArr.find(s => s.orden > refStage.orden)
      if (siguiente) {
        nuevoOrden = (refStage.orden + siguiente.orden) / 2
      } else {
        // Insertar al final, pero antes de terminales
        const terminales = stagesArr.filter(s => s.es_sistema)
        const ultimoNoTerminal = [...stagesArr].reverse().find(s => !terminales.includes(s))
        nuevoOrden = (ultimoNoTerminal?.orden ?? 0) + 1
      }
    } else {
      nuevoOrden = stagesArr.length
    }
  } else {
    // Agregar al final
    const maxOrden = stagesArr.reduce((max, s) => Math.max(max, s.orden), 0)
    nuevoOrden = maxOrden + 1
  }

  // Generar slug único
  let baseSlug = slugify(nombre)
  if (!baseSlug) baseSlug = 'etapa'
  let slug = `custom_${baseSlug}`

  // Verificar unicidad
  const { data: existingSlug } = await supabase
    .from('workspace_stages')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('entidad', input.entidad)
    .eq('slug', slug)
    .maybeSingle()

  if (existingSlug) {
    slug = `custom_${baseSlug}_${Date.now()}`
  }

  const { error: dbError } = await supabase
    .from('workspace_stages')
    .insert({
      workspace_id: workspaceId,
      entidad: input.entidad,
      nombre,
      slug,
      color: input.color || '#6B7280',
      orden: nuevoOrden,
      es_sistema: false,
      sistema_slug: null,
      es_terminal: false,
      activo: true,
    })

  if (dbError) return { error: dbError.message }

  revalidatePath('/mi-negocio')
  return { success: true }
}

/** Eliminar etapa custom (solo si es_sistema = false) */
export async function deleteCustomStage(id: string) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autorizado' }
  if (role !== 'owner') return { error: 'Solo el dueño puede eliminar etapas' }

  // Verificar que existe y no es de sistema
  const { data: stage } = await supabase
    .from('workspace_stages')
    .select('id, es_sistema')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single()

  if (!stage) return { error: 'Etapa no encontrada' }
  if (stage.es_sistema) return { error: 'No se pueden eliminar etapas del sistema' }

  // Soft delete — desactivar
  const { error: dbError } = await supabase
    .from('workspace_stages')
    .update({ activo: false })
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (dbError) return { error: dbError.message }

  revalidatePath('/mi-negocio')
  return { success: true }
}

/** Listar reglas de transición del workspace */
export async function getTransitionRules(entidad: EntidadWorkflow): Promise<TransitionRule[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('stage_transition_rules')
    .select(`
      *,
      desde_stage:workspace_stages!stage_transition_rules_desde_stage_id_fkey(id, nombre, slug, color, orden, es_sistema, sistema_slug, es_terminal, activo),
      hasta_stage:workspace_stages!stage_transition_rules_hasta_stage_id_fkey(id, nombre, slug, color, orden, es_sistema, sistema_slug, es_terminal, activo)
    `)
    .eq('workspace_id', workspaceId)
    .eq('entidad', entidad)
    .order('created_at', { ascending: true })

  return (data ?? []) as unknown as TransitionRule[]
}

/** Crear regla de transición */
export async function createTransitionRule(input: CreateRuleInput) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autorizado' }
  if (role !== 'owner') return { error: 'Solo el dueño puede crear reglas de transición' }

  if (!input.hasta_stage_id) return { error: 'Etapa destino requerida' }
  if (!input.condicion_tipo) return { error: 'Tipo de condición requerido' }

  // Validar que los stages pertenecen al workspace
  if (input.desde_stage_id) {
    const { data: desdeStage } = await supabase
      .from('workspace_stages')
      .select('id')
      .eq('id', input.desde_stage_id)
      .eq('workspace_id', workspaceId)
      .single()
    if (!desdeStage) return { error: 'Etapa origen no válida' }
  }

  const { data: hastaStage } = await supabase
    .from('workspace_stages')
    .select('id')
    .eq('id', input.hasta_stage_id)
    .eq('workspace_id', workspaceId)
    .single()
  if (!hastaStage) return { error: 'Etapa destino no válida' }

  const { error: dbError } = await supabase
    .from('stage_transition_rules')
    .insert({
      workspace_id: workspaceId,
      entidad: input.entidad,
      desde_stage_id: input.desde_stage_id || null,
      hasta_stage_id: input.hasta_stage_id,
      tipo: 'condicional',
      condicion_tipo: input.condicion_tipo,
      condicion_config: input.condicion_config as unknown as import('@/types/database').Database['public']['Tables']['stage_transition_rules']['Insert']['condicion_config'],
      activo: true,
    })

  if (dbError) return { error: dbError.message }

  revalidatePath('/mi-negocio')
  return { success: true }
}

/** Activar o desactivar una regla */
export async function toggleTransitionRule(id: string, activo: boolean) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autorizado' }
  if (role !== 'owner') return { error: 'Solo el dueño puede modificar reglas de transición' }

  const { error: dbError } = await supabase
    .from('stage_transition_rules')
    .update({ activo })
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (dbError) return { error: dbError.message }

  revalidatePath('/mi-negocio')
  return { success: true }
}
