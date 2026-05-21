'use server'

/**
 * Server actions — Superficie 4 historial etapas anteriores.
 *
 * Devuelve etapas con orden < etapa_actual.orden, sus bloques (config) y
 * los datos del negocio para cada bloque en modo read-only.
 */

import { getWorkspace } from './get-workspace'

export interface EtapaAnteriorResumen {
  etapa_id: string
  etapa_nombre: string
  stage: string | null
  orden: number
  /** Conteo de bloques en esa etapa. */
  bloquesCount: number
}

export async function getEtapasAnterioresResumen(
  negocioId: string,
): Promise<EtapaAnteriorResumen[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // 1. Negocio + etapa actual
  const { data: negocio } = await supabase
    .from('negocios')
    .select('id, linea_id, etapa_actual_id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!negocio) return []
  const n = negocio as { linea_id: string | null; etapa_actual_id: string | null }
  if (!n.linea_id || !n.etapa_actual_id) return []

  // 2. Orden de etapa actual
  const { data: etapaActual } = await supabase
    .from('etapas_negocio')
    .select('orden')
    .eq('id', n.etapa_actual_id)
    .maybeSingle()
  if (!etapaActual) return []
  const ordenActual = (etapaActual as { orden: number }).orden

  // 3. Etapas previas
  const { data: etapasRows } = await supabase
    .from('etapas_negocio')
    .select('id, nombre, stage, orden')
    .eq('linea_id', n.linea_id)
    .lt('orden', ordenActual)
    .order('orden', { ascending: true })

  const etapas = (etapasRows ?? []) as Array<{
    id: string
    nombre: string
    stage: string | null
    orden: number
  }>

  if (etapas.length === 0) return []

  // 4. Conteo de bloques por etapa (configuracion de la linea)
  const etapaIds = etapas.map((e) => e.id)
  const { data: bloquesRows } = await supabase
    .from('bloque_configs')
    .select('etapa_id')
    .in('etapa_id', etapaIds)

  const countByEtapa = new Map<string, number>()
  for (const b of (bloquesRows ?? []) as Array<{ etapa_id: string }>) {
    countByEtapa.set(b.etapa_id, (countByEtapa.get(b.etapa_id) ?? 0) + 1)
  }

  return etapas.map((e) => ({
    etapa_id: e.id,
    etapa_nombre: e.nombre,
    stage: e.stage,
    orden: e.orden,
    bloquesCount: countByEtapa.get(e.id) ?? 0,
  }))
}
