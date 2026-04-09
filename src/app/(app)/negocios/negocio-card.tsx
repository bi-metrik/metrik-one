'use client'
import Link from 'next/link'
import { FolderOpen } from 'lucide-react'
import type { NegocioResumen } from './negocio-v2-actions'

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const fmtShort = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return fmt(v)
}

const STAGE_CLASSES: Record<string, string> = {
  venta:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ejecucion: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  cobro:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

const STAGE_LABELS: Record<string, string> = {
  venta: 'VENTA', ejecucion: 'EJECUCIÓN', cobro: 'COBRO',
}

function openFolder(url: string, e: React.MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  window.open(url, '_blank', 'noopener,noreferrer')
}

export default function NegocioCard({ negocio }: { negocio: NegocioResumen }) {
  const precio = negocio.precio_aprobado ?? negocio.precio_estimado
  const pillClass = STAGE_CLASSES[negocio.stage_actual ?? ''] ?? 'bg-slate-100 text-slate-600'
  const stageLabel = STAGE_LABELS[negocio.stage_actual ?? ''] ?? negocio.stage_actual?.toUpperCase()

  // Barra de ejecución: solo en stages ejecucion/cobro y con presupuesto
  const showEjecucion = negocio.stage_actual !== 'venta' && precio && precio > 0
  const pctEjecutado = showEjecucion ? Math.round((negocio.costos_ejecutados / precio) * 100) : 0
  const barColor = pctEjecutado > 90 ? 'bg-red-500' : pctEjecutado > 70 ? 'bg-amber-500' : 'bg-[#10B981]'

  return (
    <Link href={`/negocios/${negocio.id}`} className="block rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {negocio.stage_actual && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${pillClass}`}>
                {stageLabel}
              </span>
            )}
            {negocio.etapa_nombre && (
              <span className="text-[11px] text-muted-foreground truncate">
                {negocio.etapa_nombre}
              </span>
            )}
          </div>
          <p className="font-semibold text-sm leading-tight">
            {negocio.codigo && (
              <span className="font-mono text-foreground shrink-0">{negocio.codigo}{' — '}</span>
            )}
            <span className="truncate">{negocio.nombre}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {negocio.empresa_nombre ?? negocio.contacto_nombre ?? '—'}
          </p>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            {negocio.carpeta_url && (
              <button
                type="button"
                onClick={e => openFolder(negocio.carpeta_url!, e)}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Abrir carpeta Drive"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            )}
            {precio !== null && precio !== undefined && (
              <p className="text-sm font-bold tabular-nums">{fmt(precio)}</p>
            )}
          </div>
          {negocio.precio_aprobado && (
            <span className="text-[9px] text-muted-foreground/60">aprobado</span>
          )}
        </div>
      </div>

      {/* Barra de ejecución vs presupuesto */}
      {showEjecucion && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">
              {fmtShort(negocio.costos_ejecutados)} ejecutado
            </span>
            <span className={`text-[10px] font-semibold tabular-nums ${pctEjecutado > 90 ? 'text-red-600' : pctEjecutado > 70 ? 'text-amber-600' : 'text-[#10B981]'}`}>
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
