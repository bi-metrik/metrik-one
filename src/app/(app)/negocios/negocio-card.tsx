'use client'
import Link from 'next/link'
import { FolderOpen } from 'lucide-react'
import type { NegocioResumen } from './negocio-v2-actions'

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

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
          <p className="font-semibold text-sm leading-tight truncate">{negocio.nombre}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {negocio.empresa_nombre ?? negocio.contacto_nombre ?? '—'}
          </p>
          {negocio.linea_nombre && (
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{negocio.linea_nombre}</p>
          )}
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
    </Link>
  )
}
