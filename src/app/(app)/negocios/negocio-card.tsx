'use client'
import Link from 'next/link'
import { FolderOpen, Pause, CheckCircle2, XCircle, Ban } from 'lucide-react'
import type { NegocioResumen } from './negocio-v2-actions'
import { STAGE_BADGE_CLASSES, type WorkflowStage } from '@/components/workflow/types'

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v)

const fmtShort = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return fmt(v)
}

const STAGE_LABELS: Record<string, string> = {
  venta: 'VENTA',
  ejecucion: 'EJECUCION',
  cobro: 'COBRO',
}

const CIERRE_ICONS = {
  exitoso: CheckCircle2,
  perdido: XCircle,
  cancelado: Ban,
} as const

const CIERRE_COLORS = {
  exitoso: 'text-[#10B981]',
  perdido: 'text-[#6B7280]',
  cancelado: 'text-[#EF4444]',
} as const

const CIERRE_LABELS = {
  exitoso: 'Exitoso',
  perdido: 'Perdido',
  cancelado: 'Cancelado',
} as const

function formatDateShort(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function openFolder(url: string, e: React.MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  window.open(url, '_blank', 'noopener,noreferrer')
}

export default function NegocioCard({ negocio }: { negocio: NegocioResumen }) {
  const precio = negocio.precio_aprobado ?? negocio.precio_estimado

  const isCerrado = negocio.cierre_motivo !== null
  const motivoCierre = negocio.cierre_motivo

  const stageKey = negocio.stage_actual as WorkflowStage | null
  const pillClass = isCerrado
    ? 'bg-[#F5F4F2] text-[#6B7280]'
    : stageKey && stageKey in STAGE_BADGE_CLASSES
      ? STAGE_BADGE_CLASSES[stageKey]
      : 'bg-[#F5F4F2] text-[#6B7280]'

  const stageLabel = isCerrado
    ? motivoCierre
      ? CIERRE_LABELS[motivoCierre].toUpperCase()
      : 'CERRADO'
    : (STAGE_LABELS[negocio.stage_actual ?? ''] ?? negocio.stage_actual?.toUpperCase())

  const CierreIcon = motivoCierre ? CIERRE_ICONS[motivoCierre] : null
  const cierreColor = motivoCierre ? CIERRE_COLORS[motivoCierre] : ''

  // Barra de ejecucion: solo en stages activos con presupuesto
  const showEjecucion =
    !isCerrado && negocio.stage_actual !== 'venta' && precio && precio > 0
  const pctEjecutado = showEjecucion ? Math.round((negocio.costos_ejecutados / precio) * 100) : 0
  const barColor =
    pctEjecutado > 90
      ? 'bg-[#EF4444]'
      : pctEjecutado > 70
        ? 'bg-[#F59E0B]'
        : 'bg-[#10B981]'

  return (
    <Link
      href={`/negocios/${negocio.id}`}
      className="block rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Fila 1: estado actual — [STAGE] › [E{N} Etapa] */}
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${pillClass}`}
            >
              {CierreIcon && <CierreIcon className={`h-2.5 w-2.5 ${cierreColor}`} />}
              {stageLabel}
            </span>
            {negocio.etapa_nombre && !isCerrado && (
              <>
                <span className="text-[11px] text-[#6B7280]/40">›</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${pillClass}`}
                >
                  {negocio.etapa_numero !== null && (
                    <span className="mr-1 font-mono opacity-70">E{negocio.etapa_numero}</span>
                  )}
                  <span className="truncate uppercase">{negocio.etapa_nombre}</span>
                </span>
              </>
            )}
            {negocio.pausado && !isCerrado && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F59E0B]/10 px-2 py-0.5 text-[10px] font-medium text-[#F59E0B]">
                <Pause className="h-2.5 w-2.5" />
                Pausado
              </span>
            )}
          </div>
          {/* Fila 2: contexto — L{N} Linea */}
          {negocio.linea_nombre && (
            <p className="mb-0.5 truncate text-[11px] text-[#6B7280]">
              {negocio.linea_numero !== null && (
                <span className="mr-1 font-mono text-[#6B7280]/70">L{negocio.linea_numero}</span>
              )}
              {negocio.linea_nombre}
            </p>
          )}
          <p className="text-sm font-semibold leading-tight text-[#1A1A1A]">
            {negocio.codigo && (
              <span className="shrink-0 font-mono">{negocio.codigo}{' — '}</span>
            )}
            <span className="truncate">{negocio.nombre}</span>
          </p>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            {negocio.empresa_nombre ?? negocio.contacto_nombre ?? '—'}
          </p>
          {isCerrado && negocio.closed_at && (
            <p className="mt-1 text-[10px] text-[#6B7280]">
              Cerrado {formatDateShort(negocio.closed_at)}
              {negocio.razon_cierre && (
                <>
                  {' · '}
                  <span className="italic">
                    {negocio.razon_cierre.length > 60
                      ? `${negocio.razon_cierre.slice(0, 60)}…`
                      : negocio.razon_cierre}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <div className="flex items-center gap-1.5">
            {negocio.carpeta_url && (
              <button
                type="button"
                onClick={(e) => openFolder(negocio.carpeta_url!, e)}
                className="rounded p-0.5 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#1A1A1A]"
                aria-label="Abrir carpeta Drive"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            )}
            {precio !== null && precio !== undefined && (
              <p className="text-sm font-bold tabular-nums text-[#1A1A1A]">
                {fmt(precio)}
              </p>
            )}
          </div>
          {negocio.precio_aprobado && !isCerrado && (
            <span className="text-[9px] text-[#6B7280]/70">aprobado</span>
          )}
        </div>
      </div>

      {/* Barra de ejecucion vs presupuesto */}
      {showEjecucion && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-[#6B7280]">
              {fmtShort(negocio.costos_ejecutados)} ejecutado
            </span>
            <span
              className={`text-[10px] font-semibold tabular-nums ${
                pctEjecutado > 90
                  ? 'text-[#EF4444]'
                  : pctEjecutado > 70
                    ? 'text-[#F59E0B]'
                    : 'text-[#10B981]'
              }`}
            >
              {pctEjecutado}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(pctEjecutado, 100)}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  )
}
