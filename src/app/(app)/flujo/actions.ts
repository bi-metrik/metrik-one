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
  sla_dias: number | null
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
        sla_dias?: number | null
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

function labelFor(tipo: string, nombreConfig: string | undefined): string {
  // Prefer custom config name if it has been set, else fall back to tipo label
  if (nombreConfig && nombreConfig.trim().length > 0) return nombreConfig
  return BLOQUE_LABELS[tipo] ?? tipo
}

// ── Server actions ─────────────────────────────────────────────────────────

export async function getFlujoData(lineaIdParam?: string | null): Promise<FlujoData> {
  const empty: FlujoData = { lineas: [], selectedLineaId: null, etapas: [], canConfigSla: false }
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
    return { ...empty, canConfigSla: Boolean(perms.canConfigSlaEtapas) }
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
    return { lineas, selectedLineaId, etapas: [], canConfigSla: Boolean(perms.canConfigSlaEtapas) }
  }

  const etapaIds = etapas.map(e => e.id)

  // 3) Bloques activos (config_extra.cliente_view !== false)
  const { data: bloquesRaw } = await supabase
    .from('bloque_configs')
    .select('id, etapa_id, orden, es_gate, config_extra, bloque_definitions(tipo, nombre)')
    .in('etapa_id', etapaIds)
    .eq('workspace_id', workspaceId)
    .order('orden')

  const bloques = (bloquesRaw ?? []) as unknown as BloqueConfigRow[]

  // 4) Vencimientos — vista creada en migration 20260518000001, aun no en types generados
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
    // Filtro: si cliente_view === false explicit, ocultar en vista cliente
    const cv = (b.config_extra as { cliente_view?: boolean } | null)?.cliente_view
    if (cv === false) continue
    const tipo = b.bloque_definitions?.tipo ?? 'desconocido'
    const nombreConfig = (b.config_extra as { nombre?: string } | null)?.nombre
    const arr = bloquesByEtapa.get(b.etapa_id) ?? []
    arr.push({
      config_id: b.id,
      tipo,
      nombre: labelFor(tipo, nombreConfig ?? b.bloque_definitions?.nombre),
      orden: b.orden,
      es_gate: b.es_gate,
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
      sla_dias: e.config_extra?.sla_dias ?? null,
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
  }
}

// ── Update SLA dias (owner only) ──────────────────────────────────────────

export async function updateEtapaSla(
  etapaId: string,
  slaDias: number | null
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId || !role) return { ok: false, error: 'No autenticado' }

  const perms = getRolePermissions(role)
  if (!perms.canConfigSlaEtapas) return { ok: false, error: 'Sin permisos' }

  // Validar entrada
  if (slaDias !== null) {
    if (!Number.isFinite(slaDias) || slaDias < 0 || !Number.isInteger(slaDias) || slaDias > 3650) {
      return { ok: false, error: 'SLA inválido' }
    }
  }

  // Validar que la etapa pertenece al workspace (via linea_negocio.workspace_id)
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

  const newConfig: Record<string, unknown> = { ...(etapa.config_extra ?? {}) }
  if (slaDias === null) {
    delete newConfig.sla_dias
  } else {
    newConfig.sla_dias = slaDias
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from('etapas_negocio')
    .update({ config_extra: newConfig })
    .eq('id', etapaId)

  if (updErr) return { ok: false, error: (updErr as { message: string }).message }

  revalidatePath('/flujo')
  return { ok: true }
}
