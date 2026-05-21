'use client'

/**
 * <WorkflowDiagram>
 *
 * Diagrama vertical del flujo con etapas en columna y bifurcaciones por
 * decisiones condicionales (rombos) cuando una etapa tiene routing.
 *
 * Modos:
 *  - simplified: vista cliente (/flujo). Resumen compacto colapsable por
 *    defecto en mobile (3 bloques · 1 gate · SLA 5 días), expandido en desktop.
 *  - detailed:  vista admin (/admin/workflows). Bloques expandibles con
 *    config_extra completa, gates de etapa, routing JSON.
 *
 * Layout:
 *  - Desktop (>=md): grid 2 columnas. Mainline izquierda, side-branch derecha.
 *    Línea SVG curva conecta salida bottom de la rama con entrada top de la
 *    siguiente mainline.
 *  - Mobile (<md): timeline vertical único. La rama se renderiza indentada
 *    debajo de la decisión con un margen visual y vuelve al flujo principal.
 */

import { useMemo, useState, useTransition, useId, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Clock,
  ShieldCheck,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  ArrowDown,
  ArrowRight,
  Eye,
  GitBranch,
} from 'lucide-react'
import { toast } from 'sonner'
import type { WorkflowEtapa, WorkflowBloque } from './types'
import { STAGE_COLORS, STAGE_LABELS } from './types'

interface Props {
  etapas: WorkflowEtapa[]
  mode: 'simplified' | 'detailed'
  // simplified mode
  canConfigSla?: boolean
  onUpdateSla?: (etapaId: string, slaHoras: number | null) => Promise<{ ok: boolean; error?: string }>
}

// ── Stage indicator color (borde superior) ─────────────────────────────────

const STAGE_INDICATOR_COLOR: Record<string, string> = {
  venta: '#10B981',
  ejecucion: '#F59E0B',
  cobro: '#3B82F6',
}

// ── Helpers de layout ──────────────────────────────────────────────────────

interface BranchChain {
  // Ordenes de las etapas que componen la rama, en orden de ejecucion.
  // La primera es la etapa apuntada por el conditional. Las siguientes son
  // etapas alcanzadas secuencialmente (o via routing default) hasta tocar
  // mainline, terminar o ciclar.
  etapas: number[]
  // Orden de la etapa mainline a la que la rama retorna (null si termina sin
  // volver al main).
  returnsTo: number | null
}

interface LayoutInfo {
  mainlineOrdens: Set<number>
  // Mapeo: orden de la primera etapa de cada rama → cadena completa.
  branchChains: Map<number, BranchChain>
  // Orden -> indice en el array (sorted)
  ordenIndex: Map<number, number>
}

function computeLayout(etapas: WorkflowEtapa[]): LayoutInfo {
  const sorted = [...etapas].sort((a, b) => a.orden - b.orden)
  const ordenIndex = new Map<number, number>()
  sorted.forEach((e, i) => ordenIndex.set(e.orden, i))

  const mainlineOrdens = new Set<number>()
  if (sorted.length === 0) return { mainlineOrdens, branchChains: new Map(), ordenIndex }

  // Paso 1 — Mainline: arranca en la primera etapa y sigue default_etapa_orden
  // (o orden+1 si la etapa no tiene routing). Un default que apunta a la misma
  // etapa significa "cierra aqui".
  let cur: WorkflowEtapa | undefined = sorted[0]
  const visited = new Set<number>()
  while (cur && !visited.has(cur.orden)) {
    visited.add(cur.orden)
    mainlineOrdens.add(cur.orden)
    const routing = cur.routing
    let nextOrden: number
    if (routing) {
      if (routing.default_etapa_orden === cur.orden) break
      nextOrden = routing.default_etapa_orden
    } else {
      nextOrden = cur.orden + 1
    }
    cur = sorted.find(e => e.orden === nextOrden)
  }

  // Paso 2 — Branches: para cada conditional que apunta fuera del mainline,
  // construir la cadena completa de etapas hasta tocar mainline, terminar o
  // detectar ciclo.
  const branchChains = new Map<number, BranchChain>()
  for (const e of sorted) {
    if (!e.routing) continue
    for (const rule of e.routing.conditional) {
      if (mainlineOrdens.has(rule.etapa_orden)) continue
      if (branchChains.has(rule.etapa_orden)) continue

      const chain: number[] = []
      const chainVisited = new Set<number>()
      let cur2: WorkflowEtapa | undefined = sorted.find(s => s.orden === rule.etapa_orden)
      let returnsTo: number | null = null

      while (cur2 && !chainVisited.has(cur2.orden)) {
        if (mainlineOrdens.has(cur2.orden)) {
          returnsTo = cur2.orden
          break
        }
        chainVisited.add(cur2.orden)
        chain.push(cur2.orden)
        const r = cur2.routing
        let nextOrden: number
        if (r) {
          if (r.default_etapa_orden === cur2.orden) {
            cur2 = undefined
            break
          }
          nextOrden = r.default_etapa_orden
        } else {
          nextOrden = cur2.orden + 1
        }
        cur2 = sorted.find(s => s.orden === nextOrden)
      }

      branchChains.set(rule.etapa_orden, { etapas: chain, returnsTo })
    }
  }

  return { mainlineOrdens, branchChains, ordenIndex }
}

// ── Resolver label_pregunta para una decisión ──────────────────────────────

/**
 * Busca el bloque editable que produce el `field` evaluado en routing.
 * Si encuentra `config_extra.label_pregunta`, lo usa. Si no, fallback al
 * field raw con prefijo `¿`.
 */
function resolveDecisionLabel(
  field: string,
  etapas: WorkflowEtapa[]
): string {
  for (const etapa of etapas) {
    for (const bloque of etapa.bloques) {
      const ce = bloque.config_extra as
        | { fields?: Array<{ slug?: string }>; label_pregunta?: string }
        | undefined
      if (!ce || !Array.isArray(ce.fields)) continue
      const hasField = ce.fields.some(f => f?.slug === field)
      if (hasField) {
        if (typeof ce.label_pregunta === 'string' && ce.label_pregunta.trim().length > 0) {
          return ce.label_pregunta
        }
        return `¿${field}?`
      }
    }
  }
  return `¿${field}?`
}

// ── Componente principal ───────────────────────────────────────────────────

export function WorkflowDiagram({ etapas, mode, canConfigSla, onUpdateSla }: Props) {
  const layout = useMemo(() => computeLayout(etapas), [etapas])
  const sorted = useMemo(() => [...etapas].sort((a, b) => a.orden - b.orden), [etapas])

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-white p-8 text-center">
        <p className="text-sm text-[#6B7280]">Esta línea aún no tiene etapas configuradas.</p>
      </div>
    )
  }

  type Row =
    | { type: 'etapa'; etapa: WorkflowEtapa; side: 'main' }
    | {
        type: 'decision-with-branch'
        sourceEtapa: WorkflowEtapa
        branchEtapas: WorkflowEtapa[]
        branchLabel: string
        defaultLabel: string
        defaultTargetNombre: string | null
      }
    | { type: 'decision'; sourceEtapa: WorkflowEtapa; defaultLabel: string }
    | { type: 'terminal' }

  const rows: Row[] = []

  for (const e of sorted) {
    if (!layout.mainlineOrdens.has(e.orden)) continue

    rows.push({ type: 'etapa', etapa: e, side: 'main' })

    if (e.routing) {
      const branchRule = e.routing.conditional.find(r => layout.branchChains.has(r.etapa_orden))
      const branchChain = branchRule ? layout.branchChains.get(branchRule.etapa_orden) : undefined
      const branchEtapas: WorkflowEtapa[] = branchChain
        ? branchChain.etapas
            .map(o => sorted.find(s => s.orden === o))
            .filter((x): x is WorkflowEtapa => Boolean(x))
        : []
      const branchLabel = branchRule
        ? `${branchRule.condition.field} = ${branchRule.condition.value}`
        : ''

      const defaultTarget = sorted.find(t => t.orden === e.routing!.default_etapa_orden)
      const defaultLabel = defaultTarget
        ? `${String(defaultTarget.orden).padStart(2, '0')} ${defaultTarget.nombre}`
        : 'Cierre'

      if (branchEtapas.length > 0) {
        rows.push({
          type: 'decision-with-branch',
          sourceEtapa: e,
          branchEtapas,
          branchLabel,
          defaultLabel,
          defaultTargetNombre: defaultTarget?.nombre ?? null,
        })
      } else {
        rows.push({ type: 'decision', sourceEtapa: e, defaultLabel })
      }
    }
  }

  const lastMainline = sorted.filter(e => layout.mainlineOrdens.has(e.orden)).pop()
  if (lastMainline) {
    rows.push({ type: 'terminal' })
  }

  return (
    <div>
      <div className="space-y-0">
        {rows.map((row, idx) => {
          if (row.type === 'etapa') {
            return (
              <div key={`etapa-${row.etapa.id}`} className="grid grid-cols-1 md:grid-cols-2 md:gap-3">
                <div>
                  <EtapaCard
                    etapa={row.etapa}
                    mode={mode}
                    canConfigSla={canConfigSla}
                    onUpdateSla={onUpdateSla}
                  />
                  <Connector />
                </div>
                <div className="hidden md:block" />
              </div>
            )
          }
          if (row.type === 'decision') {
            const field = row.sourceEtapa.routing?.conditional[0]?.condition.field ?? '—'
            const question = resolveDecisionLabel(field, sorted)
            return (
              <div key={`dec-${idx}`} className="grid grid-cols-1 md:grid-cols-2 md:gap-3">
                <div>
                  <DecisionDiamond
                    question={question}
                    branchLabel={null}
                    branchTargetNombre={null}
                    defaultLabel={row.defaultLabel}
                  />
                  <Connector />
                </div>
                <div className="hidden md:block" />
              </div>
            )
          }
          if (row.type === 'decision-with-branch') {
            const field = row.sourceEtapa.routing?.conditional[0]?.condition.field ?? '—'
            const question = resolveDecisionLabel(field, sorted)
            const firstBranch = row.branchEtapas[0]
            const restBranch = row.branchEtapas.slice(1)
            return (
              <div
                key={`decbr-${idx}`}
                className="grid grid-cols-1 md:grid-cols-2 md:gap-3 md:items-start"
              >
                {/* Decision diamond (mainline) */}
                <div>
                  <DecisionDiamond
                    question={question}
                    branchLabel={row.branchLabel}
                    branchTargetNombre={firstBranch?.nombre ?? null}
                    defaultLabel={row.defaultLabel}
                  />
                  <Connector />
                </div>
                {/* Branch chain (1+ etapas en orden) */}
                {firstBranch && (
                  <div className="relative">
                    {/* Mobile: timeline indentado */}
                    <div className="md:hidden ml-6 border-l-2 border-dashed border-[#10B981] pl-4 pb-2">
                      <BranchHeader direction="in" labelOverride="Rama: SÍ" />
                      <EtapaCard
                        etapa={firstBranch}
                        mode={mode}
                        canConfigSla={canConfigSla}
                        onUpdateSla={onUpdateSla}
                        isBranch
                      />
                      {restBranch.map(etapa => (
                        <div key={`m-br-${etapa.id}`}>
                          <Connector />
                          <EtapaCard
                            etapa={etapa}
                            mode={mode}
                            canConfigSla={canConfigSla}
                            onUpdateSla={onUpdateSla}
                            isBranch
                          />
                        </div>
                      ))}
                      <BranchHeader direction="out" />
                    </div>
                    {/* Desktop: columna derecha */}
                    <div className="hidden md:block">
                      <BranchHeader direction="in" />
                      <EtapaCard
                        etapa={firstBranch}
                        mode={mode}
                        canConfigSla={canConfigSla}
                        onUpdateSla={onUpdateSla}
                        isBranch
                      />
                      {restBranch.map(etapa => (
                        <div key={`d-br-${etapa.id}`}>
                          <Connector />
                          <EtapaCard
                            etapa={etapa}
                            mode={mode}
                            canConfigSla={canConfigSla}
                            onUpdateSla={onUpdateSla}
                            isBranch
                          />
                        </div>
                      ))}
                      <BranchReturnConnector />
                    </div>
                  </div>
                )}
              </div>
            )
          }
          if (row.type === 'terminal') {
            return (
              <div key={`term-${idx}`} className="grid grid-cols-1 md:grid-cols-2 md:gap-3">
                <div>
                  <TerminalNode />
                </div>
                <div className="hidden md:block" />
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

// ── Connector vertical line con flecha ─────────────────────────────────────

function Connector() {
  return (
    <div className="flex justify-center my-1" aria-hidden>
      <div className="flex flex-col items-center">
        <div className="h-3 w-px bg-[#6B7280]" />
        <div className="h-0 w-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[5px] border-t-[#6B7280]" />
      </div>
    </div>
  )
}

// ── Branch header (SÍ entrada / vuelve al flujo) ──────────────────────────

function BranchHeader({ direction, labelOverride }: { direction: 'in' | 'out'; labelOverride?: string }) {
  if (direction === 'in') {
    return (
      <div className="flex items-center gap-1.5 mb-1.5 text-[11px]" aria-hidden>
        <span className="font-semibold text-[#10B981] uppercase tracking-wider">
          {labelOverride ?? 'SÍ ↓ Rama'}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5 mt-2 text-[11px] text-[#6B7280]" aria-hidden>
      <ArrowDown className="h-3 w-3" />
      <span>Vuelve al flujo principal</span>
    </div>
  )
}

// ── Branch return curve (desktop) — SVG curva del bottom del card a la siguiente mainline ──

function BranchReturnConnector() {
  return (
    <div className="relative h-10" aria-hidden>
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
      >
        {/* Curva desde top-center (entrada del card) ya viene del header.
            Aqui: curva del bottom-center del card hacia abajo-izquierda hasta
            el centro de la columna izquierda (mainline). */}
        <path
          d="M 50 0 Q 50 25 0 35"
          fill="none"
          stroke="#6B7280"
          strokeWidth="1.5"
          strokeDasharray="0"
        />
        {/* Arrowhead */}
        <polygon points="0,35 6,32 6,38" fill="#6B7280" />
      </svg>
    </div>
  )
}

// ── Decision diamond ───────────────────────────────────────────────────────

function DecisionDiamond({
  question,
  branchLabel,
  branchTargetNombre,
  defaultLabel,
}: {
  question: string
  branchLabel: string | null
  branchTargetNombre: string | null
  defaultLabel: string
}) {
  return (
    <div className="my-2 flex flex-col items-center">
      {/* Rombo: contenedor cuadrado rotado 45deg + contenido sin rotar */}
      <div className="relative" style={{ width: '280px', maxWidth: '100%' }}>
        <div
          className="relative mx-auto"
          style={{ width: '200px', height: '200px' }}
        >
          {/* Rombo de fondo (SVG para línea limpia + responsive) */}
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 200 200"
            aria-hidden
          >
            <polygon
              points="100,4 196,100 100,196 4,100"
              fill="#FFFFFF"
              stroke="#10B981"
              strokeWidth="2"
            />
          </svg>
          {/* Contenido centrado */}
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <HelpCircle className="h-4 w-4 text-[#10B981]" aria-hidden />
            <p
              className="mt-1 text-[12px] font-semibold leading-tight text-[#1A1A1A]"
              style={{ maxWidth: '120px' }}
            >
              {question}
            </p>
          </div>
        </div>
        {/* Etiquetas de salida */}
        <div className="mt-2 flex flex-col gap-1 text-[12px]">
          {branchLabel && (
            <div className="flex items-center justify-center gap-1.5">
              <span className="font-semibold text-[#10B981]">SÍ</span>
              <ArrowDown className="h-3.5 w-3.5 text-[#10B981]" />
              <span className="text-[#1A1A1A]">
                {branchTargetNombre ? `Rama: ${branchTargetNombre}` : 'Rama lateral'}
              </span>
              <span className="text-[#6B7280]">({branchLabel})</span>
            </div>
          )}
          <div className="flex items-center justify-center gap-1.5">
            <span className="font-semibold text-[#6B7280]">NO</span>
            {branchLabel ? (
              <ArrowRight className="h-3.5 w-3.5 text-[#6B7280]" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5 text-[#6B7280]" />
            )}
            <span className="text-[#1A1A1A]">{defaultLabel}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Terminal node (cierre del flujo) ──────────────────────────────────────

function TerminalNode() {
  return (
    <div
      className="mx-auto max-w-[260px] rounded-full border px-5 py-2 text-center text-[12px] font-semibold"
      style={{ borderColor: '#1A1A1A', backgroundColor: '#1A1A1A', color: '#FFFFFF' }}
    >
      Cierre del negocio
    </div>
  )
}

// ── Hook: detect desktop (md breakpoint) con SSR fallback ─────────────────

const DESKTOP_QUERY = '(min-width: 768px)'

function subscribeMedia(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const mql = window.matchMedia(DESKTOP_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getDesktopSnapshot(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(DESKTOP_QUERY).matches
}

function getDesktopServerSnapshot(): boolean {
  return false
}

function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeMedia, getDesktopSnapshot, getDesktopServerSnapshot)
}

// ── Etapa card ─────────────────────────────────────────────────────────────

function EtapaCard({
  etapa,
  mode,
  canConfigSla,
  onUpdateSla,
  isBranch,
}: {
  etapa: WorkflowEtapa
  mode: 'simplified' | 'detailed'
  canConfigSla?: boolean
  onUpdateSla?: (etapaId: string, slaHoras: number | null) => Promise<{ ok: boolean; error?: string }>
  isBranch?: boolean
}) {
  const tieneAlerta = etapa.sla_horas !== null && etapa.sla_horas > 0 && etapa.vencidos > 0
  const routing = etapa.routing ?? null
  const gates = etapa.gates ?? []
  const isDesktop = useIsDesktop()
  // Simplified mode: por default colapsado en mobile, expandido en desktop.
  // El usuario puede sobreescribir manualmente (null = sin override).
  const [bloquesOverride, setBloquesOverride] = useState<boolean | null>(null)
  const defaultExpanded = mode === 'simplified' ? isDesktop : true
  const bloquesExpanded = bloquesOverride ?? defaultExpanded
  const [detailExpanded, setDetailExpanded] = useState(mode === 'detailed')

  const stageIndicator = STAGE_INDICATOR_COLOR[etapa.stage] ?? '#6B7280'

  // Bloques summary line (simplified, colapsado)
  const totalBloques = etapa.bloques.length
  const totalGates = etapa.bloques.filter(b => b.es_gate).length
  const slaText = etapa.sla_horas !== null && etapa.sla_horas > 0
    ? formatSlaShort(etapa.sla_horas)
    : null

  const summaryParts: string[] = []
  if (totalBloques > 0) summaryParts.push(`${totalBloques} bloque${totalBloques === 1 ? '' : 's'}`)
  if (totalGates > 0) summaryParts.push(`${totalGates} gate${totalGates === 1 ? '' : 's'}`)
  if (slaText) summaryParts.push(slaText)
  const summaryLine = summaryParts.join(' · ')

  return (
    <article
      className="rounded-xl border bg-white shadow-sm overflow-hidden"
      style={{
        borderColor: isBranch ? '#10B981' : '#E5E7EB',
        borderWidth: isBranch ? '1.5px' : '1px',
        borderTop: `3px solid ${stageIndicator}`,
      }}
    >
      {/* Header */}
      <header
        className="flex items-start justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: '#E5E7EB' }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Badge circular numerado */}
            <span
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-white text-[14px] font-semibold leading-none"
              style={{
                width: '28px',
                height: '28px',
                border: '2px solid #10B981',
                color: '#1A1A1A',
                fontFamily: 'var(--font-montserrat), Montserrat, sans-serif',
              }}
              aria-label={`Etapa ${etapa.orden}`}
            >
              {etapa.orden}
            </span>
            <h3 className="truncate text-sm font-bold text-[#1A1A1A]">{etapa.nombre}</h3>
            {isBranch && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: '#ECFDF5', color: '#059669' }}
              >
                Rama
              </span>
            )}
          </div>
          {/* Stage badge: solo en detailed */}
          {mode === 'detailed' && (
            <span
              className="mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: STAGE_COLORS[etapa.stage].bg,
                color: STAGE_COLORS[etapa.stage].text,
                borderColor: STAGE_COLORS[etapa.stage].border,
              }}
            >
              {STAGE_LABELS[etapa.stage]}
            </span>
          )}
          {mode === 'detailed' && etapa.is_active === false && (
            <span className="ml-2 inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">
              inactiva
            </span>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[11px] font-semibold text-[#1A1A1A]"
            title={`${etapa.abiertos} negocio(s) abierto(s) en esta etapa`}
          >
            {etapa.abiertos}
          </span>
          {tieneAlerta && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}
              title={`${etapa.vencidos} vencido(s) (SLA ${etapa.sla_horas} horas hábiles)`}
            >
              <AlertTriangle className="h-3 w-3" />
              {etapa.vencidos}
            </span>
          )}
        </div>
      </header>

      {/* SLA config */}
      <SlaConfig
        etapaId={etapa.id}
        slaHoras={etapa.sla_horas}
        canEdit={Boolean(canConfigSla)}
        onUpdateSla={onUpdateSla}
      />

      {/* Bloques */}
      <div className="px-4 py-3">
        {etapa.bloques.length === 0 ? (
          <p className="text-[11px] italic text-[#6B7280]">Sin bloques configurados.</p>
        ) : mode === 'simplified' ? (
          <>
            {!bloquesExpanded ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-[#6B7280]">
                  {summaryLine || `${totalBloques} bloque${totalBloques === 1 ? '' : 's'}`}
                </span>
                <button
                  type="button"
                  onClick={() => setBloquesOverride(true)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[#10B981] transition-colors hover:bg-[#F5F4F2]"
                >
                  Ver más
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {etapa.bloques.map(b => {
                    const isReadOnly = b.readonly === true || b.estado === 'visible'
                    const isCondicional = Boolean(b.condition_field)
                    return (
                      <li
                        key={b.config_id}
                        className="flex items-center gap-2 text-[12px]"
                        style={{ color: isReadOnly ? '#6B7280' : '#1A1A1A' }}
                      >
                        {isReadOnly ? (
                          <Eye
                            className="h-3 w-3 shrink-0 text-[#6B7280]"
                            aria-hidden
                          />
                        ) : (
                          <span
                            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: b.es_gate ? '#10B981' : '#6B7280' }}
                            title={b.es_gate ? 'Gate (bloquea avance)' : 'Bloque normal'}
                          />
                        )}
                        <span className="flex-1 truncate">{b.nombre}</span>
                        {isCondicional && (
                          <span
                            className="inline-flex shrink-0"
                            title={`Aparece si ${b.condition_field} = ${b.condition_value}`}
                            aria-label="Condicional"
                          >
                            <GitBranch className="h-3 w-3 text-[#6B7280]" />
                          </span>
                        )}
                        {!isReadOnly && b.es_gate && (
                          <span
                            className="inline-flex shrink-0"
                            title="Gate (bloquea avance)"
                            aria-label="Gate"
                          >
                            <ShieldCheck className="h-3 w-3 text-[#10B981]" />
                          </span>
                        )}
                        <span
                          className="hidden shrink-0 rounded-full bg-[#F5F4F2] px-1.5 py-[1px] text-[9px] font-mono uppercase tracking-wider text-[#6B7280] sm:inline-block"
                          title={`Tipo de bloque: ${b.tipo}`}
                        >
                          {b.tipo}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                {/* Solo en mobile: botón colapsar */}
                <button
                  type="button"
                  onClick={() => setBloquesOverride(false)}
                  className="md:hidden mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[#6B7280] transition-colors hover:bg-[#F5F4F2]"
                >
                  Ver menos
                  <ChevronDown className="h-3 w-3 rotate-180" />
                </button>
              </>
            )}
          </>
        ) : (
          <div className="space-y-1.5">
            {etapa.bloques.map(b => (
              <DetailedBloqueRow key={b.config_id} bloque={b} />
            ))}
          </div>
        )}
      </div>

      {/* Detailed extras: gates de etapa + routing */}
      {mode === 'detailed' && ((gates && gates.length > 0) || routing) && (
        <div className="border-t border-[#E5E7EB] bg-[#F5F4F2]">
          <button
            type="button"
            onClick={() => setDetailExpanded(v => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] hover:bg-[#E5E7EB]/40"
          >
            <span>Config de etapa</span>
            {detailExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          {detailExpanded && (
            <div className="space-y-2 border-t border-[#E5E7EB] p-3">
              {gates && gates.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Gates</p>
                  <ul className="space-y-0.5">
                    {gates.map(g => (
                      <li key={g} className="font-mono text-[11px] text-[#1A1A1A]">{g}</li>
                    ))}
                  </ul>
                </div>
              )}
              {routing && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Routing</p>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] text-[#1A1A1A]">
                    {JSON.stringify(routing, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

// ── Detailed bloque row (expandible) ───────────────────────────────────────

function DetailedBloqueRow({ bloque }: { bloque: WorkflowBloque }) {
  const [expanded, setExpanded] = useState(false)
  const hasConfig = bloque.config_extra && Object.keys(bloque.config_extra).length > 0
  const isReadOnly = bloque.readonly === true || bloque.estado === 'visible'
  const isCondicional = Boolean(bloque.condition_field)

  return (
    <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
      <header
        className={`flex items-center justify-between gap-2 px-3 py-1.5 ${hasConfig ? 'cursor-pointer hover:bg-[#F5F4F2]' : ''}`}
        onClick={() => hasConfig && setExpanded(!expanded)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: bloque.es_gate ? '#10B981' : '#6B7280' }}
          />
          <span className="shrink-0 text-[10px] font-mono text-[#6B7280]">{bloque.orden}</span>
          <span className="truncate text-[12px] font-semibold text-[#1A1A1A]">{bloque.nombre}</span>
          <span className="rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[10px] font-mono text-[#6B7280]">{bloque.tipo}</span>
          {isCondicional && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[10px] font-medium text-[#6B7280]"
              title={`Aparece si ${bloque.condition_field} = ${bloque.condition_value}`}
            >
              <GitBranch className="h-3 w-3" />
              condicional
            </span>
          )}
          {isReadOnly && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[#F5F4F2] px-2 py-0.5 text-[10px] font-medium text-[#6B7280]"
              title={
                bloque.source_etapa_orden != null
                  ? `Solo lectura — heredado de etapa ${bloque.source_etapa_orden}`
                  : 'Solo lectura'
              }
            >
              <Eye className="h-3 w-3" />
              solo lectura
            </span>
          )}
          {bloque.es_gate && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-medium text-[#059669]">
              <ShieldCheck className="h-3 w-3" />
              gate
            </span>
          )}
        </div>
        {hasConfig && (
          expanded
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
        )}
      </header>
      {expanded && hasConfig && (
        <div className="border-t border-[#E5E7EB] bg-[#F5F4F2] px-3 py-2">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] text-[#1A1A1A]">
            {JSON.stringify(bloque.config_extra, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── SLA helpers (horas hábiles Colombia) ──────────────────────────────────

export function formatSlaShort(slaHoras: number): string {
  if (slaHoras >= 24 && slaHoras % 24 === 0) {
    const dias = slaHoras / 24
    return `SLA ${slaHoras}h (${dias} día${dias === 1 ? '' : 's'} hábil${dias === 1 ? '' : 'es'})`
  }
  return `SLA ${slaHoras} hora${slaHoras === 1 ? '' : 's'} hábil${slaHoras === 1 ? '' : 'es'}`
}

export function formatSlaLong(slaHoras: number): string {
  if (slaHoras >= 24 && slaHoras % 24 === 0) {
    const dias = slaHoras / 24
    return `${slaHoras}h (${dias} día${dias === 1 ? '' : 's'} hábil${dias === 1 ? '' : 'es'})`
  }
  return `${slaHoras} hora${slaHoras === 1 ? '' : 's'} hábil${slaHoras === 1 ? '' : 'es'}`
}

// ── SLA config inline (compartido ambos modos) ────────────────────────────

function SlaConfig({
  etapaId,
  slaHoras,
  canEdit,
  onUpdateSla,
}: {
  etapaId: string
  slaHoras: number | null
  canEdit: boolean
  onUpdateSla?: (etapaId: string, slaHoras: number | null) => Promise<{ ok: boolean; error?: string }>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(slaHoras?.toString() ?? '')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const inputId = useId()

  if (!canEdit && slaHoras === null) {
    return null
  }

  if (!editing) {
    return (
      <div
        className="flex items-center justify-between gap-2 border-b px-4 py-2"
        style={{ borderColor: '#E5E7EB' }}
      >
        <div className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
          <Clock className="h-3 w-3" />
          {slaHoras !== null ? (
            <span>SLA: <span className="font-semibold text-[#1A1A1A]">{formatSlaLong(slaHoras)}</span></span>
          ) : (
            <span>Sin alerta</span>
          )}
        </div>
        {canEdit && onUpdateSla && (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md p-1 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#1A1A1A]"
            title="Configurar SLA"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  const save = () => {
    if (!onUpdateSla) return
    const trimmed = value.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 9999)) {
      toast.error('Ingresa un número entero entre 0 y 9999 (o vacía para quitar la alerta)')
      return
    }
    startTransition(async () => {
      const res = await onUpdateSla(etapaId, parsed)
      if (res.ok) {
        toast.success(parsed === null ? 'Alerta desactivada' : `SLA actualizado a ${formatSlaLong(parsed)}`)
        setEditing(false)
        router.refresh()
      } else {
        toast.error(res.error ?? 'No se pudo guardar')
      }
    })
  }

  return (
    <div className="border-b bg-[#F5F4F2] px-3 py-2" style={{ borderColor: '#E5E7EB' }}>
      <label htmlFor={inputId} className="block text-[10px] font-medium text-[#6B7280]">
        Horas hábiles esperadas en esta etapa (L-V Colombia)
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={9999}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Sin alerta"
          disabled={isPending}
          className="w-full rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[12px] text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-50"
        />
        <button
          onClick={save}
          disabled={isPending}
          className="rounded-md bg-[#10B981] p-1 text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
          title="Guardar"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          onClick={() => { setEditing(false); setValue(slaHoras?.toString() ?? '') }}
          disabled={isPending}
          className="rounded-md bg-white p-1 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] disabled:opacity-50"
          style={{ border: '1px solid #E5E7EB' }}
          title="Cancelar"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <p className="mt-1 text-[10px] text-[#6B7280]">Excluye sábados, domingos y festivos. Vacía el campo para desactivar la alerta.</p>
    </div>
  )
}
