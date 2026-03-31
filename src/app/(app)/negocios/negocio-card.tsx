'use client'
import Link from 'next/link'
import type { NegocioItem } from './negocios-actions'

const PILL_COLORS: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

const BAR_COLORS = (pct: number) =>
  pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500'

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function NegocioCard({ negocio }: { negocio: NegocioItem }) {
  const href = negocio.tipo === 'oportunidad'
    ? `/pipeline/${negocio.id}`
    : `/proyectos/${negocio.id}`

  const pct = negocio.presupuestoConsumidoPct ?? null
  const pillClass = PILL_COLORS[negocio.colorStage] ?? PILL_COLORS.slate

  return (
    <Link href={href} className="block rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-muted-foreground font-mono">{negocio.codigoDisplay}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${pillClass}`}>
              {negocio.etiquetaStage}
            </span>
          </div>
          <p className="font-semibold text-sm leading-tight truncate">{negocio.nombre}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{negocio.cliente}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold tabular-nums">{fmt(negocio.valor)}</p>
        </div>
      </div>
      {pct !== null && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Presupuesto consumido</span>
            <span className={`text-[10px] font-semibold ${pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-green-600'}`}>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full transition-all ${BAR_COLORS(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        </div>
      )}
    </Link>
  )
}
