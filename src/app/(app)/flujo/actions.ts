'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface FlujoLinea {
  id: string
  nombre: string
  tipo: string
  is_active: boolean
}

export interface FlujoBloque {
  config_id: string
  tipo: string
  nombre: string
  orden: number
  es_gate: boolean
  estado: 'editable' | 'visible'
  readonly: boolean
  source_etapa_orden: number | null
  condition_field: string | null
  condition_value: string | null
}

export interface FlujoRoutingConditional {
  condition: { field: string; value: string }
  etapa_orden: number
}

export interface FlujoRouting {
  default_etapa_orden: number
  conditional: FlujoRoutingConditional[]
  source_etapa_orden?: number
}

export interface FlujoEtapa {
  id: string
  nombre: string
  stage: 'venta' | 'ejecucion' | 'cobro'
  orden: number
  sla_horas: number | null
  bloques: FlujoBloque[]
  abiertos: number
  vencidos: number
  routing: FlujoRouting | null
  gates: string[]
}

export interface FlujoData {
  lineas: FlujoLinea[]
  selectedLineaId: string | null
  etapas: FlujoEtapa[]
  canConfigSla: boolean
  canViewSlaLog: boolean
}

export interface SlaLogEntry {
  id: string
  changed_at: string
  user_name: string | null
  etapa_nombre: string
  etapa_orden: number
  old_sla_horas: number | null
  new_sla_horas: number | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface LineaRow {
  id: string
  nombre: string
  tipo: string
  is_active: boolean
}

interface EtapaRow {
  id: string
  nombre: string
  stage: 'venta' | 'ejecucion' | 'cobro'
  orden: number
  config_extra:
    | {
        sla_horas?: number | null
        routing?: FlujoRouting | null
        gates?: string[]
      }
    | null
}

interface BloqueConfigRow {
  id: string
  etapa_id: string
  orden: number
  es_gate: boolean
  estado: 'editable' | 'visible' | null
  nombre: string | null
  config_extra: Record<string, unknown> | null
  bloque_definitions: { tipo: string; nombre: string } | null
}

interface VencimientoRow {
  etapa_id: string
  abiertos: number
  vencidos: number
}

const BLOQUE_LABELS: Record<string, string> = {
  datos: 'Datos',
  documentos: 'Documentos',
  cotizacion: 'Cotización',
  cobros: 'Cobros',
  checklist: 'Checklist',
  checklist_soporte: 'Checklist con soporte',
  equipo: 'Equipo',
  aprobacion: 'Aprobación',
  cronograma: 'Cronograma',
  resumen_financiero: 'Resumen financiero',
  ejecucion: 'Ejecución',
  historial: 'Historial',
  plan_recurrente: 'Plan recurrente',
}

function labelFor(tipo: string, nombreConfig: string | null | undefined): string {
  if (nombreConfig && nombreConfig.trim().length > 0) return nombreConfig
  return BLOQUE_LABELS[tipo] ?? tipo
}

// ── Server actions ─────────────────────────────────────────────────────────

export async function getFlujoData(lineaIdParam?: string | null): Promise<FlujoData> {
  const empty: FlujoData = {
    lineas: [],
    selectedLineaId: null,
    etapas: [],
    canConfigSla: false,
    canViewSlaLog: false,
  }
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId || !role) return empty

  const perms = getRolePermissions(role)
  if (!perms.canViewFlujo) return empty

  // 1) Lineas activas del workspace
  const { data: lineasRaw } = await supabase
    .from('lineas_negocio')
    .select('id, nombre, tipo, is_active')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('nombre')

  const lineas = (lineasRaw ?? []) as LineaRow[]
  if (lineas.length === 0) {
    return {
      ...empty,
      canConfigSla: Boolean(perms.canConfigSlaEtapas),
      canViewSlaLog: Boolean(perms.canViewSlaLog),
    }
  }

  const selected = lineas.find(l => l.id === lineaIdParam) ?? lineas[0]
  const selectedLineaId = selected.id

  // 2) Etapas de la linea
  const { data: etapasRaw } = await supabase
    .from('etapas_negocio')
    .select('id, nombre, stage, orden, config_extra')
    .eq('linea_id', selectedLineaId)
    .eq('is_active', true)
    .order('orden')

  const etapas = (etapasRaw ?? []) as EtapaRow[]
  if (etapas.length === 0) {
    return {
      lineas,
      selectedLineaId,
      etapas: [],
      canConfigSla: Boolean(perms.canConfigSlaEtapas),
      canViewSlaLog: Boolean(perms.canViewSlaLog),
    }
  }

  const etapaIds = etapas.map(e => e.id)

  // 3) Bloques activos
  const { data: bloquesRaw } = await supabase
    .from('bloque_configs')
    .select('id, etapa_id, orden, es_gate, estado, nombre, config_extra, bloque_definitions(tipo, nombre)')
    .in('etapa_id', etapaIds)
    .eq('workspace_id', workspaceId)
    .order('orden')

  const bloques = (bloquesRaw ?? []) as unknown as BloqueConfigRow[]

  // 4) Vencimientos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vencRaw } = await (supabase as any)
    .from('v_negocios_etapa_vencimiento')
    .select('etapa_id, abiertos, vencidos')
    .eq('workspace_id', workspaceId)
    .in('etapa_id', etapaIds)

  const vencs = (vencRaw ?? []) as unknown as VencimientoRow[]
  const vencByEtapa = new Map<string, { abiertos: number; vencidos: number }>()
  for (const v of vencs) {
    vencByEtapa.set(v.etapa_id, { abiertos: Number(v.abiertos) || 0, vencidos: Number(v.vencidos) || 0 })
  }

  const bloquesByEtapa = new Map<string, FlujoBloque[]>()
  for (const b of bloques) {
    const cfgExtra = b.config_extra as
      | {
          cliente_view?: boolean
          visible?: boolean
          readonly?: boolean
          source_etapa_orden?: number
          condition?: { field?: string; value?: string }
          label?: string
          nombre?: string
        }
      | null
    if (cfgExtra?.cliente_view === false) continue
    if (cfgExtra?.visible === false) continue
    const tipo = b.bloque_definitions?.tipo ?? 'desconocido'
    const bcNombre = b.nombre
    const cfgLabel = cfgExtra?.label
    const cfgNombre = cfgExtra?.nombre
    const arr = bloquesByEtapa.get(b.etapa_id) ?? []
    arr.push({
      config_id: b.id,
      tipo,
      nombre: labelFor(
        tipo,
        bcNombre ?? cfgLabel ?? cfgNombre ?? b.bloque_definitions?.nombre
      ),
      orden: b.orden,
      es_gate: b.es_gate,
      estado: b.estado ?? 'editable',
      readonly: cfgExtra?.readonly === true,
      source_etapa_orden:
        typeof cfgExtra?.source_etapa_orden === 'number'
          ? cfgExtra.source_etapa_orden
          : null,
      condition_field:
        typeof cfgExtra?.condition?.field === 'string'
          ? cfgExtra.condition.field
          : null,
      condition_value:
        typeof cfgExtra?.condition?.value === 'string'
          ? cfgExtra.condition.value
          : null,
    })
    bloquesByEtapa.set(b.etapa_id, arr)
  }

  const result: FlujoEtapa[] = etapas.map(e => {
    const venc = vencByEtapa.get(e.id) ?? { abiertos: 0, vencidos: 0 }
    return {
      id: e.id,
      nombre: e.nombre,
      stage: e.stage,
      orden: e.orden,
      sla_horas: e.config_extra?.sla_horas ?? null,
      bloques: (bloquesByEtapa.get(e.id) ?? []).sort((a, b) => a.orden - b.orden),
      abiertos: venc.abiertos,
      vencidos: venc.vencidos,
      routing: e.config_extra?.routing ?? null,
      gates: Array.isArray(e.config_extra?.gates) ? (e.config_extra.gates as string[]) : [],
    }
  })

  return {
    lineas,
    selectedLineaId,
    etapas: result,
    canConfigSla: Boolean(perms.canConfigSlaEtapas),
    canViewSlaLog: Boolean(perms.canViewSlaLog),
  }
}

// ── Update SLA horas (owner only) ─────────────────────────────────────────

export async function updateEtapaSla(
  etapaId: string,
  slaHoras: number | null
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !role) return { ok: false, error: 'No autenticado' }

  const perms = getRolePermissions(role)
  if (!perms.canConfigSlaEtapas) return { ok: false, error: 'Sin permisos' }

  // Validar entrada
  if (slaHoras !== null) {
    if (!Number.isFinite(slaHoras) || slaHoras < 0 || !Number.isInteger(slaHoras) || slaHoras > 9999) {
      return { ok: false, error: 'SLA inválido' }
    }
  }

  // Validar que la etapa pertenece al workspace
  const { data: etapaRaw } = await supabase
    .from('etapas_negocio')
    .select('id, linea_id, config_extra, lineas_negocio!inner(workspace_id)')
    .eq('id', etapaId)
    .single()

  type EtapaJoin = {
    id: string
    linea_id: string
    config_extra: Record<string, unknown> | null
    lineas_negocio: { workspace_id: string } | null
  }
  const etapa = etapaRaw as unknown as EtapaJoin | null

  if (!etapa) return { ok: false, error: 'Etapa no encontrada' }
  if (etapa.lineas_negocio?.workspace_id !== workspaceId) {
    return { ok: false, error: 'Etapa fuera de workspace' }
  }

  const oldConfig = (etapa.config_extra ?? {}) as Record<string, unknown>
  const oldSlaHoras = typeof oldConfig.sla_horas === 'number' ? (oldConfig.sla_horas as number) : null

  const newConfig: Record<string, unknown> = { ...oldConfig }
  if (slaHoras === null) {
    delete newConfig.sla_horas
  } else {
    newConfig.sla_horas = slaHoras
  }

  // No-op: no escribir log si no cambio
  if (oldSlaHoras === slaHoras) {
    return { ok: true }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from('etapas_negocio')
    .update({ config_extra: newConfig })
    .eq('id', etapaId)

  if (updErr) return { ok: false, error: (updErr as { message: string }).message }

  // Log de auditoria
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('etapa_sla_log').insert({
    etapa_id: etapaId,
    workspace_id: workspaceId,
    changed_by: userId,
    old_sla_horas: oldSlaHoras,
    new_sla_horas: slaHoras,
  })

  revalidatePath('/flujo')
  revalidatePath('/admin/workflows')
  return { ok: true }
}

// ── Historial de cambios SLA ──────────────────────────────────────────────

export async function getSlaChangeLog(
  lineaId?: string | null,
  limit: number = 50
): Promise<SlaLogEntry[]> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId || !role) return []

  const perms = getRolePermissions(role)
  if (!perms.canViewSlaLog) return []

  const safeLimit = Math.min(Math.max(limit, 1), 200)

  // Query: log + etapa + profile
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('etapa_sla_log')
    .select(
      'id, changed_at, old_sla_horas, new_sla_horas, changed_by, ' +
        'etapas_negocio!inner(id, nombre, orden, linea_id), ' +
        'profiles(full_name)'
    )
    .eq('workspace_id', workspaceId)
    .order('changed_at', { ascending: false })
    .limit(safeLimit)

  if (lineaId) {
    q = q.eq('etapas_negocio.linea_id', lineaId)
  }

  const { data: rows } = await q

  type Row = {
    id: string
    changed_at: string
    old_sla_horas: number | null
    new_sla_horas: number | null
    changed_by: string | null
    etapas_negocio: { id: string; nombre: string; orden: number; linea_id: string } | null
    profiles: { full_name: string | null } | null
  }

  const entries = (rows ?? []) as Row[]
  return entries.map(r => ({
    id: r.id,
    changed_at: r.changed_at,
    user_name: r.profiles?.full_name ?? null,
    etapa_nombre: r.etapas_negocio?.nombre ?? '—',
    etapa_orden: r.etapas_negocio?.orden ?? 0,
    old_sla_horas: r.old_sla_horas,
    new_sla_horas: r.new_sla_horas,
  }))
}
