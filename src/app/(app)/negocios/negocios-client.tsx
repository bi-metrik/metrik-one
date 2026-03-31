'use client'
import { useState } from 'react'
import NegocioCard from './negocio-card'
import type { NegocioItem, NegocioStage } from './negocios-actions'

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const FILTROS: { key: NegocioStage; label: string; color: string; bgActive: string }[] = [
  { key: 'propuestas', label: 'Propuestas', color: 'text-amber-600', bgActive: 'bg-amber-50 border-amber-200 dark:bg-amber-950/20' },
  { key: 'en-curso', label: 'En curso', color: 'text-green-600', bgActive: 'bg-green-50 border-green-200 dark:bg-green-950/20' },
  { key: 'por-cobrar', label: 'Por cobrar', color: 'text-blue-600', bgActive: 'bg-blue-50 border-blue-200 dark:bg-blue-950/20' },
  { key: 'historial', label: 'Historial', color: 'text-slate-500', bgActive: 'bg-slate-50 border-slate-200 dark:bg-slate-900/20' },
]

interface Props {
  propuestas: NegocioItem[]
  enCurso: NegocioItem[]
  porCobrar: NegocioItem[]
  historial: NegocioItem[]
  totales: { pipeline: number; contratado: number; porCobrar: number }
}

export default function NegociosClient({ propuestas, enCurso, porCobrar, historial, totales }: Props) {
  const [filtro, setFiltro] = useState<NegocioStage>('propuestas')

  const items: Record<NegocioStage, NegocioItem[]> = {
    propuestas,
    'en-curso': enCurso,
    'por-cobrar': porCobrar,
    historial,
  }

  const resumen: Record<NegocioStage, string> = {
    propuestas: `Pipeline: ${fmt(totales.pipeline)}`,
    'en-curso': `Contratado: ${fmt(totales.contratado)}`,
    'por-cobrar': `Por cobrar: ${fmt(totales.porCobrar)}`,
    historial: '',
  }

  const current = items[filtro]

  return (
    <div className="space-y-4">
      {/* Pills de filtro */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {FILTROS.map(f => {
          const count = items[f.key].length
          const active = filtro === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? `${f.bgActive} ${f.color} border-current`
                  : `border-border text-muted-foreground hover:border-current hover:${f.color}`
              }`}
            >
              {f.label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-current/10' : 'bg-muted'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Resumen del filtro activo */}
      {resumen[filtro] && (
        <p className="text-xs font-medium text-muted-foreground">{resumen[filtro]}</p>
      )}

      {/* Lista */}
      {current.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Sin negocios en esta etapa</p>
      ) : (
        <div className="space-y-3">
          {current.map(n => <NegocioCard key={n.id} negocio={n} />)}
        </div>
      )}
    </div>
  )
}
