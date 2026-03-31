'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { addHoras } from '../../proyectos/actions-v2'

export { addHoras }

// ── Get active projects for horas selector ────────────────────

export async function getProyectosParaHoras() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('proyectos')
    .select('id, nombre, tipo, codigo')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'en_ejecucion')
    .order('nombre')

  return (data ?? []).map(p => ({
    id: p.id,
    nombre: p.nombre ?? 'Sin nombre',
    tipo: p.tipo ?? 'cliente',
    codigo: p.codigo ?? '',
  }))
}

// ── Get active staff for horas selector ──────────────────────

export async function getStaffActivo() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('staff')
    .select('id, full_name, tipo_vinculo, es_principal')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('es_principal', { ascending: false })
    .order('full_name')

  return (data ?? []).map(s => ({
    id: s.id,
    full_name: s.full_name ?? 'Sin nombre',
    tipo_vinculo: s.tipo_vinculo,
    es_principal: s.es_principal,
  }))
}
