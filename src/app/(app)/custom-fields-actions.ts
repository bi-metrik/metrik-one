'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createClient } from '@/lib/supabase/server'

type Entidad = 'oportunidad' | 'proyecto' | 'contacto' | 'empresa'

// ── Helper: evaluar y aplicar transición automática de etapa ──────────────────

async function applyAutoTransition(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  entidadId: string,
  entidadTipo: 'oportunidad' | 'proyecto',
) {
  // Llamar a la función PostgreSQL
  const { data: destStageId, error: rpcError } = await supabase.rpc('evaluate_stage_rules', {
    p_entidad_id: entidadId,
    p_workspace_id: workspaceId,
    p_entidad_tipo: entidadTipo,
  })

  if (rpcError || !destStageId) return // Sin transición aplicable

  // Obtener slug del stage destino
  const { data: stage } = await supabase
    .from('workspace_stages')
    .select('slug, sistema_slug, nombre')
    .eq('id', destStageId)
    .single()

  if (!stage) return

  const nuevoSlug = stage.sistema_slug || stage.slug
  const campo = entidadTipo === 'oportunidad' ? 'etapa' : 'estado'

  // Obtener etapa actual para el log
  let etapaAnterior: string | null = null
  if (entidadTipo === 'oportunidad') {
    const { data } = await supabase
      .from('oportunidades')
      .select('etapa')
      .eq('id', entidadId)
      .eq('workspace_id', workspaceId)
      .single()
    etapaAnterior = data?.etapa ?? null
  } else {
    const { data } = await supabase
      .from('proyectos')
      .select('estado')
      .eq('id', entidadId)
      .eq('workspace_id', workspaceId)
      .single()
    etapaAnterior = data?.estado ?? null
  }

  if (etapaAnterior === nuevoSlug) return // Ya está en esa etapa

  // Aplicar la transición
  if (entidadTipo === 'oportunidad') {
    await supabase
      .from('oportunidades')
      .update({ etapa: nuevoSlug })
      .eq('id', entidadId)
      .eq('workspace_id', workspaceId)
  } else {
    await supabase
      .from('proyectos')
      .update({ estado: nuevoSlug })
      .eq('id', entidadId)
      .eq('workspace_id', workspaceId)
  }

  // Registrar en activity_log
  await supabase.from('activity_log').insert({
    workspace_id: workspaceId,
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    tipo: 'stage_auto_transition',
    campo_modificado: campo,
    valor_anterior: etapaAnterior,
    valor_nuevo: nuevoSlug,
    contenido: `Transición automática: ${etapaAnterior} → ${nuevoSlug} (regla de flujo aplicada)`,
  })
}

export async function getCustomFields(entidad: Entidad) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('custom_fields')
    .select('id, nombre, slug, tipo, opciones, obligatorio, orden, condicion_visibilidad')
    .eq('workspace_id', workspaceId)
    .eq('entidad', entidad)
    .eq('activo', true)
    .order('orden')

  return data ?? []
}

export async function getLabels(entidad: Entidad) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('labels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('entidad', entidad)

  return data ?? []
}

export async function getEntityLabels(entidad: Entidad, entidadId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('entity_labels')
    .select('*, label:labels(*)')
    .eq('workspace_id', workspaceId)
    .eq('entidad', entidad)
    .eq('entidad_id', entidadId)

  return data ?? []
}

export async function updateCustomData(
  entidad: Entidad,
  entidadId: string,
  customData: Record<string, unknown>,
) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autorizado' }

  const table = entidad === 'oportunidad' ? 'oportunidades'
    : entidad === 'proyecto' ? 'proyectos'
    : entidad === 'contacto' ? 'contactos'
    : 'empresas'

  const { error: dbError } = await supabase
    .from(table)
    .update({ custom_data: customData as unknown as Record<string, never> })
    .eq('id', entidadId)
    .eq('workspace_id', workspaceId)

  if (dbError) return { error: dbError.message }

  // Evaluar transiciones automáticas solo para oportunidades y proyectos
  if (entidad === 'oportunidad' || entidad === 'proyecto') {
    await applyAutoTransition(supabase, workspaceId, entidadId, entidad)
  }

  return { success: true }
}

export async function toggleEntityLabel(
  entidad: Entidad,
  entidadId: string,
  labelId: string,
  action: 'add' | 'remove',
) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autorizado' }

  if (action === 'add') {
    const { error: dbError } = await supabase
      .from('entity_labels')
      .insert({
        workspace_id: workspaceId,
        entidad,
        entidad_id: entidadId,
        label_id: labelId,
      })
    if (dbError) return { error: dbError.message }
  } else {
    const { error: dbError } = await supabase
      .from('entity_labels')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('entidad_id', entidadId)
      .eq('label_id', labelId)
    if (dbError) return { error: dbError.message }
  }

  return { success: true }
}

export async function getFieldMappings(origenEntidad: Entidad, destinoEntidad: Entidad) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('custom_field_mappings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('origen_entidad', origenEntidad)
    .eq('destino_entidad', destinoEntidad)
    .eq('activo', true)

  return data ?? []
}
