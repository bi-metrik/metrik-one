'use client'
import { useState } from 'react'
import NegocioCard from './negocio-card'
import type { NegocioResumen } from './negocio-v2-actions'

type StageFilter = 'todos' | 'venta' | 'ejecucion' | 'cobro'

const ALL_FILTROS: { key: StageFilter; label: string; color: string; bgActive: string }[] = [
  { key: 'todos',     label: 'Todos',     color: 'text-slate-600',  bgActive: 'bg-slate-100 border-slate-300' },
  { key: 'venta',     label: 'Venta',     color: 'text-blue-600',   bgActive: 'bg-blue-50 border-blue-200' },
  { key: 'ejecucion', label: 'Ejecución', color: 'text-orange-600', bgActive: 'bg-orange-50 border-orange-200' },
  { key: 'cobro',     label: 'Cobro',     color: 'text-green-600',  bgActive: 'bg-green-50 border-green-200' },
]

export default function NegociosClient({ negocios, stagesActivos }: { negocios: NegocioResumen[]; stagesActivos: string[] }) {
  const [filtro, setFiltro] = useState<StageFilter>('todos')

  const current = filtro === 'todos'
    ? negocios
    : negocios.filter(n => n.stage_actual === filtro)

  // Filter pills: only show active stages. If only 1 stage active, no pills needed.
  const filtros = ALL_FILTROS.filter(f => f.key === 'todos' || stagesActivos.includes(f.key))
  const showPills = stagesActivos.length > 1

  return (
    <div className="space-y-4">
      {/* Pills de filtro — hidden if only one stage active */}
      {showPills && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {filtros.map(f => {
            const count = f.key === 'todos' ? negocios.length : negocios.filter(n => n.stage_actual === f.key).length
            const active = filtro === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFiltro(f.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? `${f.bgActive} ${f.color} border-current`
                    : 'border-border text-muted-foreground hover:border-border hover:text-foreground'
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
      )}

      {/* Lista */}
      {current.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {filtro === 'todos' ? 'Sin negocios activos' : `Sin negocios en ${ALL_FILTROS.find(f => f.key === filtro)?.label}`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">Crea uno con el botón +</p>
        </div>
      ) : (
        <div className="space-y-3">
          {current.map(n => <NegocioCard key={n.id} negocio={n} />)}
        </div>
      )}
    </div>
  )
}
