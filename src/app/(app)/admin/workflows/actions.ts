'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getWorkspace } from '@/lib/actions/get-workspace'

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface AdminLineaItem {
  workspace_id: string
  workspace_slug: string | null
  workspace_name: string | null
  linea_id: string
  linea_nombre: string
  linea_tipo: string
  is_active: boolean
  total_etapas: number
  total_bloques: number
}

export interface AdminBloque {
  config_id: string
  tipo: string
  nombre_definition: string
  orden: number
  estado: 'editable' | 'visible'
  es_gate: boolean
  config_extra: Record<string, unknown>
}

export interface AdminEtapa {
  id: string
  nombre: string
  stage: 'venta' | 'ejecucion' | 'cobro'
  orden: number
  is_active: boolean
  config_extra: Record<string, unknown>
  bloques: AdminBloque[]
  abiertos: number
  vencidos: number
}

export interface AdminFlujoDetalle {
  workspace: {
    id: string
    slug: string | null
    name: string | null
  }
  linea: {
    id: string
    nombre: string
    tipo: string
    is_active: boolean
  }
  etapas: AdminEtapa[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<{ ok: boolean }> {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) {
    return { ok: false }
  }
  return { ok: true }
}

// ── List workflows (workspaces × lineas) ──────────────────────────────────

export async function listAdminWorkflows(): Promise<AdminLineaItem[]> {
  const auth = await requireAdmin()
  if (!auth.ok) return []

  const svc = createServiceClient()

  // 1) Lineas que pertenecen a un workspace (excluye plantillas globales con workspace_id=null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lineasRaw } = await (svc as any)
    .from('lineas_negocio')
    .select('id, nombre, tipo, is_active, workspace_id, workspaces(id, slug, name)')
    .not('workspace_id', 'is', null)
    .order('nombre')

  type LineaJoin = {
    id: string
    nombre: string
    tipo: string
    is_active: boolean
    workspace_id: string
    workspaces: { id: string; slug: string | null; name: string | null } | null
  }
  const lineas = (lineasRaw ?? []) as LineaJoin[]

  if (lineas.length === 0) return []

  const lineaIds = lineas.map(l => l.id)

  // 2) Etapas count
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: etapasRaw } = await (svc as any)
    .from('etapas_negocio')
    .select('id, linea_id')
    .in('linea_id', lineaIds)

  const etapas = (etapasRaw ?? []) as { id: string; linea_id: string }[]
  const etapasByLinea = new Map<string, string[]>()
  for (const e of etapas) {
    const arr = etapasByLinea.get(e.linea_id) ?? []
    arr.push(e.id)
    etapasByLinea.set(e.linea_id, arr)
  }

  const etapaIds = etapas.map(e => e.id)
  const bloquesByEtapaId = new Map<string, number>()
  if (etapaIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bcRaw } = await (svc as any)
      .from('bloque_configs')
      .select('etapa_id')
      .in('etapa_id', etapaIds)
    const bcs = (bcRaw ?? []) as { etapa_id: string }[]
    for (const b of bcs) {
      bloquesByEtapaId.set(b.etapa_id, (bloquesByEtapaId.get(b.etapa_id) ?? 0) + 1)
    }
  }

  return lineas.map((l) => {
    const eIds = etapasByLinea.get(l.id) ?? []
    const totalBloques = eIds.reduce((acc, id) => acc + (bloquesByEtapaId.get(id) ?? 0), 0)
    return {
      workspace_id: l.workspace_id,
      workspace_slug: l.workspaces?.slug ?? null,
      workspace_name: l.workspaces?.name ?? null,
      linea_id: l.id,
      linea_nombre: l.nombre,
      linea_tipo: l.tipo,
      is_active: l.is_active,
      total_etapas: eIds.length,
      total_bloques: totalBloques,
    }
  })
}

// ── Detalle de un flujo (workspace + linea) ───────────────────────────────

export async function getAdminFlujoDetalle(
  workspaceId: string,
  lineaId: string
): Promise<AdminFlujoDetalle | null> {
  const auth = await requireAdmin()
  if (!auth.ok) return null

  const svc = createServiceClient()

  // 1) Workspace + linea
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lineaRaw } = await (svc as any)
    .from('lineas_negocio')
    .select('id, nombre, tipo, is_active, workspace_id, workspaces(id, slug, name)')
    .eq('id', lineaId)
    .single()

  type LineaJoin = {
    id: string
    nombre: string
    tipo: string
    is_active: boolean
    workspace_id: string
    workspaces: { id: string; slug: string | null; name: string | null } | null
  }
  const linea = lineaRaw as LineaJoin | null
  if (!linea || linea.workspace_id !== workspaceId) return null

  // 2) Etapas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: etapasRaw } = await (svc as any)
    .from('etapas_negocio')
    .select('id, nombre, stage, orden, is_active, config_extra')
    .eq('linea_id', lineaId)
    .order('orden')

  type EtapaRow = {
    id: string
    nombre: string
    stage: 'venta' | 'ejecucion' | 'cobro'
    orden: number
    is_active: boolean
    config_extra: Record<string, unknown> | null
  }
  const etapas = (etapasRaw ?? []) as EtapaRow[]

  if (etapas.length === 0) {
    return {
      workspace: { id: linea.workspace_id, slug: linea.workspaces?.slug ?? null, name: linea.workspaces?.name ?? null },
      linea: { id: linea.id, nombre: linea.nombre, tipo: linea.tipo, is_active: linea.is_active },
      etapas: [],
    }
  }

  const etapaIds = etapas.map(e => e.id)

  // 3) Bloque configs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bcRaw } = await (svc as any)
    .from('bloque_configs')
    .select('id, etapa_id, orden, estado, es_gate, config_extra, bloque_definitions(tipo, nombre)')
    .in('etapa_id', etapaIds)
    .eq('workspace_id', workspaceId)
    .order('orden')

  type BcRow = {
    id: string
    etapa_id: string
    orden: number
    estado: 'editable' | 'visible'
    es_gate: boolean
    config_extra: Record<string, unknown> | null
    bloque_definitions: { tipo: string; nombre: string } | null
  }
  const bcs = (bcRaw ?? []) as BcRow[]

  const bloquesByEtapa = new Map<string, AdminBloque[]>()
  for (const b of bcs) {
    const arr = bloquesByEtapa.get(b.etapa_id) ?? []
    arr.push({
      config_id: b.id,
      tipo: b.bloque_definitions?.tipo ?? 'desconocido',
      nombre_definition: b.bloque_definitions?.nombre ?? 'Desconocido',
      orden: b.orden,
      estado: b.estado,
      es_gate: b.es_gate,
      config_extra: b.config_extra ?? {},
    })
    bloquesByEtapa.set(b.etapa_id, arr)
  }

  // 4) Vencimientos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vencRaw } = await (svc as any)
    .from('v_negocios_etapa_vencimiento')
    .select('etapa_id, abiertos, vencidos')
    .eq('workspace_id', workspaceId)
    .in('etapa_id', etapaIds)

  const vencs = (vencRaw ?? []) as { etapa_id: string; abiertos: number; vencidos: number }[]
  const vencByEtapa = new Map<string, { abiertos: number; vencidos: number }>()
  for (const v of vencs) {
    vencByEtapa.set(v.etapa_id, { abiertos: Number(v.abiertos) || 0, vencidos: Number(v.vencidos) || 0 })
  }

  const etapasDet: AdminEtapa[] = etapas.map(e => {
    const venc = vencByEtapa.get(e.id) ?? { abiertos: 0, vencidos: 0 }
    return {
      id: e.id,
      nombre: e.nombre,
      stage: e.stage,
      orden: e.orden,
      is_active: e.is_active,
      config_extra: e.config_extra ?? {},
      bloques: (bloquesByEtapa.get(e.id) ?? []).sort((a, b) => a.orden - b.orden),
      abiertos: venc.abiertos,
      vencidos: venc.vencidos,
    }
  })

  return {
    workspace: { id: linea.workspace_id, slug: linea.workspaces?.slug ?? null, name: linea.workspaces?.name ?? null },
    linea: { id: linea.id, nombre: linea.nombre, tipo: linea.tipo, is_active: linea.is_active },
    etapas: etapasDet,
  }
}
