'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'

type Entidad = 'oportunidad' | 'proyecto' | 'contacto' | 'empresa'

export async function getCustomFields(entidad: Entidad) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('custom_fields')
    .select('*')
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
