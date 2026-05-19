'use client'

/**
 * <WorkflowDiagram>
 *
 * Diagrama vertical del flujo con etapas en columna y bifurcaciones por
 * decisiones condicionales (rombos) cuando una etapa tiene routing.
 *
 * Modos:
 *  - simplified: vista cliente (/flujo). Lista de bloques por nombre, badges
 *    de cantidad + vencidos, config SLA inline si canConfigSla.
 *  - detailed:  vista admin (/admin/workflows). Bloques expandibles con
 *    config_extra completa, gates de etapa, routing JSON.
 *
 * Layout: grid de 2 columnas. Mainline a la izquierda (etapas alcanzables via
 * default), side-branches a la derecha (etapas alcanzables solo por
 * conditional). Conectores via SVG entre rows.
 */

import { useMemo, useState, useTransition, useId } from 'react'
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
  GitFork,
} from 'lucide-react'
import { toast } from 'sonner'
import type { WorkflowEtapa, WorkflowBloque } from './types'
import { STAGE_COLORS, STAGE_LABELS } from './types'

interface Props {
  etapas: WorkflowEtapa[]
  mode: 'simplified' | 'detailed'
  // simplified mode
  canConfigSla?: boolean
  onUpdateSla?: (etapaId: string, slaDias: number | null) => Promise<{ ok: boolean; error?: string }>
}

// ── Helpers de layout ──────────────────────────────────────────────────────

interface LayoutInfo {
  mainlineOrdens: Set<number>
  // Mapeo de orden de etapa side-branch → orden de etapa mainline a la que
  // retorna (siguiente mainline despues del decision que la enruta).
  branchReturnsTo: Map<number, number>
  // Orden -> indice en el array (sorted)
  ordenIndex: Map<number, number>
}

function computeLayout(etapas: WorkflowEtapa[]): LayoutInfo {
  const sorted = [...etapas].sort((a, b) => a.orden - b.orden)
  const ordenIndex = new Map<number, number>()
  sorted.forEach((e, i) => ordenIndex.set(e.orden, i))

  // Mainline = camino default desde la primera etapa
  const mainlineOrdens = new Set<number>()
  if (sorted.length === 0) return { mainlineOrdens, branchReturnsTo: new Map(), ordenIndex }

  let cur: WorkflowEtapa | undefined = sorted[0]
  const visited = new Set<number>()
  while (cur && !visited.has(cur.orden)) {
    visited.add(cur.orden)
    mainlineOrdens.add(cur.orden)
    const routing = cur.routing
    let nextOrden: number
    if (routing) {
      nextOrden = routing.default_etapa_orden
    } else {
      nextOrden = cur.orden + 1
    }
    cur = sorted.find(e => e.orden === nextOrden)
  }

  // Side-branches: para cada etapa con routing, las conditional targets que no
  // estan en mainline son side-branches. Su return point = el default de la
  // etapa que las enruta (que sera el siguiente mainline desde alli).
  const branchReturnsTo = new Map<number, number>()
  for (const e of sorted) {
    if (!e.routing) continue
    for (const rule of e.routing.conditional) {
      if (!mainlineOrdens.has(rule.etapa_orden)) {
        branchReturnsTo.set(rule.etapa_orden, e.routing.default_etapa_orden)
      }
    }
  }

  return { mainlineOrdens, branchReturnsTo, ordenIndex }
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

  // Construir filas del diagrama. Cada row es uno de:
  // - { type:'etapa', etapa, side: 'main' | 'branch', branchTargetOrden? }
  // - { type:'decision', sourceEtapa, branches: [{label, targetOrden, isBranch}] }
  // Side-branches: las renderizamos en la misma row del decision que las enruta.
  type Row =
    | { type: 'etapa'; etapa: WorkflowEtapa; side: 'main' }
    | { type: 'decision-with-branch'; sourceEtapa: WorkflowEtapa; branchEtapa: WorkflowEtapa | null; branchLabel: string; defaultLabel: string }
    | { type: 'decision'; sourceEtapa: WorkflowEtapa }
    | { type: 'terminal' }

  const rows: Row[] = []
  const renderedBranches = new Set<number>()

  for (const e of sorted) {
    if (!layout.mainlineOrdens.has(e.orden)) continue // side-branches se renderizan en la row del decision

    rows.push({ type: 'etapa', etapa: e, side: 'main' })

    if (e.routing) {
      // Buscar primer conditional con target side-branch
      const branchRule = e.routing.conditional.find(r => layout.branchReturnsTo.has(r.etapa_orden))
      const branchEtapa = branchRule ? sorted.find(b => b.orden === branchRule.etapa_orden) ?? null : null
      const branchLabel = branchRule ? `${branchRule.condition.field} = ${branchRule.condition.value}` : ''

      // Default target
      const defaultTarget = sorted.find(t => t.orden === e.routing!.default_etapa_orden)
      const defaultLabel = defaultTarget
        ? `→ ${String(defaultTarget.orden).padStart(2, '0')} ${defaultTarget.nombre}`
        : `→ Cierre`

      if (branchEtapa) {
        rows.push({
          type: 'decision-with-branch',
          sourceEtapa: e,
          branchEtapa,
          branchLabel,
          defaultLabel,
        })
        renderedBranches.add(branchEtapa.orden)
      } else {
        rows.push({ type: 'decision', sourceEtapa: e })
      }
    }
  }

  // Etapa terminal cuando la ultima mainline cierra (sea por routing default a
  // un orden inexistente o por orden final).
  const lastMainline = sorted.filter(e => layout.mainlineOrdens.has(e.orden)).pop()
  if (lastMainline) {
    rows.push({ type: 'terminal' })
  }

  return (
    <div className="space-y-0">
      {rows.map((row, idx) => {
        if (row.type === 'etapa') {
          return (
            <div key={`etapa-${row.etapa.id}`} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <EtapaCard
                  etapa={row.etapa}
                  mode={mode}
                  canConfigSla={canConfigSla}
                  onUpdateSla={onUpdateSla}
                />
                {/* connector down */}
                <Connector />
              </div>
              <div />
            </div>
          )
        }
        if (row.type === 'decision') {
          return (
            <div key={`dec-${idx}`} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <DecisionPill
                  field={row.sourceEtapa.routing?.conditional[0]?.condition.field ?? '—'}
                  branchLabel={null}
                  defaultLabel={
                    sorted.find(t => t.orden === row.sourceEtapa.routing!.default_etapa_orden)
                      ? `→ ${String(row.sourceEtapa.routing!.default_etapa_orden).padStart(2, '0')}`
                      : '→ Cierre'
                  }
                />
                <Connector />
              </div>
              <div />
            </div>
          )
        }
        if (row.type === 'decision-with-branch') {
          return (
            <div key={`decbr-${idx}`} className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              <div>
                <DecisionPill
                  field={row.sourceEtapa.routing?.conditional[0]?.condition.field ?? '—'}
                  branchLabel={row.branchLabel}
                  defaultLabel={row.defaultLabel}
                />
                <Connector />
              </div>
              {row.branchEtapa && (
                <div className="relative">
                  <BranchArrow direction="in" />
                  <EtapaCard
                    etapa={row.branchEtapa}
                    mode={mode}
                    canConfigSla={canConfigSla}
                    onUpdateSla={onUpdateSla}
                    isBranch
                  />
                  <BranchArrow direction="out" />
                </div>
              )}
            </div>
          )
        }
        if (row.type === 'terminal') {
          return (
            <div key={`term-${idx}`} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <TerminalNode />
              </div>
              <div />
            </div>
          )
        }
        return null
      })}
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

// ── Branch arrows: in (decision → branch card) y out (branch card → mainline) ──

function BranchArrow({ direction }: { direction: 'in' | 'out' }) {
  // 'in': flecha horizontal pequena entrando por la izquierda al top del card
  // 'out': curva del bottom del card hacia abajo-izquierda (vuelve a mainline)
  if (direction === 'in') {
    return (
      <div className="flex items-center gap-1 mb-1.5 text-[10px] text-[#6B7280]" aria-hidden>
        <span className="h-px w-6 bg-[#6B7280]" />
        <span className="h-0 w-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[5px] border-l-[#6B7280]" />
        <span className="font-semibold text-[#10B981]">SÍ</span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-start gap-1 mt-1.5 text-[10px] text-[#6B7280]" aria-hidden>
      <span className="font-semibold text-[#6B7280]">vuelve al flujo</span>
      <span className="h-px w-6 bg-[#6B7280]" />
      <span className="h-0 w-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-r-[5px] border-r-[#6B7280]" />
    </div>
  )
}

// ── Decision pill (rombo aplanado con etiquetas) ───────────────────────────

function DecisionPill({
  field,
  branchLabel,
  defaultLabel,
}: {
  field: string
  branchLabel: string | null
  defaultLabel: string
}) {
  return (
    <div
      className="mx-auto max-w-[420px] rounded-lg border-2 px-4 py-2.5 text-center"
      style={{ borderColor: '#10B981', backgroundColor: '#F0FDF4' }}
    >
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#059669]">
        <GitFork className="h-3.5 w-3.5" />
        <span>Decisión</span>
      </div>
      <p className="mt-1 text-[12px] font-bold text-[#1A1A1A]">
        ¿{field}?
      </p>
      <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-[#1A1A1A]">
        {branchLabel && (
          <p>
            <span className="font-semibold text-[#10B981]">SÍ </span>
            <span className="text-[#6B7280]">({branchLabel})</span>
            <span className="ml-1 text-[#6B7280]">→ rama lateral</span>
          </p>
        )}
        <p>
          <span className="font-semibold text-[#6B7280]">NO </span>
          <span className="text-[#6B7280]">{defaultLabel}</span>
        </p>
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
  onUpdateSla?: (etapaId: string, slaDias: number | null) => Promise<{ ok: boolean; error?: string }>
  isBranch?: boolean
}) {
  const stageColor = STAGE_COLORS[etapa.stage]
  const tieneAlerta = etapa.sla_dias !== null && etapa.sla_dias > 0 && etapa.vencidos > 0
  const routing = etapa.routing ?? null
  const gates = etapa.gates ?? []
  const [detailExpanded, setDetailExpanded] = useState(mode === 'detailed')

  return (
    <article
      className="rounded-xl border bg-white shadow-sm overflow-hidden"
      style={{
        borderColor: isBranch ? '#10B981' : '#E5E7EB',
        borderWidth: isBranch ? '1.5px' : '1px',
      }}
    >
      {/* Header */}
      <header
        className="flex items-start justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: '#E5E7EB' }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-[#6B7280]">
              {String(etapa.orden).padStart(2, '0')}
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
          <span
            className="mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: stageColor.bg,
              color: stageColor.text,
              borderColor: stageColor.border,
            }}
          >
            {STAGE_LABELS[etapa.stage]}
          </span>
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
              title={`${etapa.vencidos} vencido(s) (SLA ${etapa.sla_dias} días)`}
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
        slaDias={etapa.sla_dias}
        canEdit={Boolean(canConfigSla)}
        onUpdateSla={onUpdateSla}
      />

      {/* Bloques */}
      <div className="px-4 py-3">
        {etapa.bloques.length === 0 ? (
          <p className="text-[11px] italic text-[#6B7280]">Sin bloques configurados.</p>
        ) : mode === 'simplified' ? (
          <ul className="space-y-1.5">
            {etapa.bloques.map(b => (
              <li
                key={b.config_id}
                className="flex items-center gap-2 text-[12px] text-[#1A1A1A]"
              >
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: b.es_gate ? '#10B981' : '#6B7280' }}
                  title={b.es_gate ? 'Gate (bloquea avance)' : 'Bloque normal'}
                />
                <span className="flex-1 truncate">{b.nombre}</span>
                {b.es_gate && (
                  <ShieldCheck className="h-3 w-3 shrink-0 text-[#10B981]" />
                )}
              </li>
            ))}
          </ul>
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
          {bloque.estado && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: bloque.estado === 'editable' ? '#DBEAFE' : '#F3F4F6',
                color: bloque.estado === 'editable' ? '#1D4ED8' : '#6B7280',
              }}
            >
              {bloque.estado}
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

// ── SLA config inline (compartido ambos modos) ────────────────────────────

function SlaConfig({
  etapaId,
  slaDias,
  canEdit,
  onUpdateSla,
}: {
  etapaId: string
  slaDias: number | null
  canEdit: boolean
  onUpdateSla?: (etapaId: string, slaDias: number | null) => Promise<{ ok: boolean; error?: string }>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(slaDias?.toString() ?? '')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const inputId = useId()

  if (!canEdit && slaDias === null) {
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
          {slaDias !== null ? (
            <span>SLA: <span className="font-semibold text-[#1A1A1A]">{slaDias} día{slaDias === 1 ? '' : 's'}</span></span>
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
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650)) {
      toast.error('Ingresa un número entero entre 0 y 3650 (o vacía para quitar la alerta)')
      return
    }
    startTransition(async () => {
      const res = await onUpdateSla(etapaId, parsed)
      if (res.ok) {
        toast.success(parsed === null ? 'Alerta desactivada' : `SLA actualizado a ${parsed} días`)
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
        Días esperados en esta etapa
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={3650}
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
          onClick={() => { setEditing(false); setValue(slaDias?.toString() ?? '') }}
          disabled={isPending}
          className="rounded-md bg-white p-1 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] disabled:opacity-50"
          style={{ border: '1px solid #E5E7EB' }}
          title="Cancelar"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <p className="mt-1 text-[10px] text-[#6B7280]">Vacía el campo para desactivar la alerta.</p>
    </div>
  )
}
