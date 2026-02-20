'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FolderOpen } from 'lucide-react'
import { formatCOP } from '@/lib/contacts/constants'
import { ESTADO_PROYECTO_CONFIG } from '@/lib/pipeline/constants'
import type { EstadoProyecto } from '@/lib/pipeline/constants'

// ── Types ─────────────────────────────────────────────

interface ProyectoFinanciero {
  proyecto_id: string | null
  nombre: string | null
  estado: string | null
  presupuesto_total: number | null
  avance_porcentaje: number | null
  presupuesto_consumido_pct: number | null
  ganancia_real: number | null
  empresa_nombre: string | null
  cobrado: number | null
  facturado: number | null
  cartera: number | null
  horas_reales: number | null
  created_at: string | null
}

interface Props {
  proyectos: ProyectoFinanciero[]
}

// ── Filter chips ──────────────────────────────────────

type FilterTab = 'todos' | 'en_ejecucion' | 'pausado' | 'cerrado'

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'en_ejecucion', label: 'En ejecución' },
  { key: 'pausado', label: 'Pausados' },
  { key: 'cerrado', label: 'Cerrados' },
]

// ── Component ─────────────────────────────────────────

export default function ProyectosList({ proyectos }: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('todos')

  const filtered = activeFilter === 'todos'
    ? proyectos
    : proyectos.filter(p => p.estado === activeFilter)

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Proyectos</h1>
        <span className="text-sm text-muted-foreground">{filtered.length} proyecto{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeFilter === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {tab.label}
            {tab.key !== 'todos' && (
              <span className="ml-1 opacity-70">
                ({proyectos.filter(p => p.estado === tab.key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Project cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            {activeFilter === 'todos'
              ? 'No hay proyectos aun. Gana una oportunidad para crear tu primer proyecto.'
              : 'No hay proyectos en este estado.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => <ProyectoCard key={p.proyecto_id} proyecto={p} />)}
        </div>
      )}
    </div>
  )
}

// ── Project Card ──────────────────────────────────────

function ProyectoCard({ proyecto: p }: { proyecto: ProyectoFinanciero }) {
  const estado = (p.estado ?? 'en_ejecucion') as EstadoProyecto
  const config = ESTADO_PROYECTO_CONFIG[estado]
  const avance = Math.min(p.avance_porcentaje ?? 0, 100)
  const consumo = Math.min(p.presupuesto_consumido_pct ?? 0, 150)
  const ganancia = p.ganancia_real ?? 0

  // Semáforo for presupuesto consumido bar
  const semaforoBar = consumo > 90
    ? 'bg-red-500'
    : consumo > 70
      ? 'bg-yellow-500'
      : 'bg-green-500'

  return (
    <Link
      href={`/proyectos/${p.proyecto_id}`}
      className="block rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* Row 1: Name + Status + Value */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{p.nombre ?? 'Sin nombre'}</h3>
          {p.empresa_nombre && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.empresa_nombre}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {p.presupuesto_total ? (
            <span className="text-sm font-semibold">{formatCOP(p.presupuesto_total)}</span>
          ) : null}
          {config && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${config.chipClass}`}>
              {config.label}
            </span>
          )}
        </div>
      </div>

      {/* Row 2: Dual progress bars */}
      <div className="mt-3 space-y-1.5">
        {/* Avance bar */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] text-muted-foreground shrink-0">Avance</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${Math.min(avance, 100)}%` }}
            />
          </div>
          <span className="w-10 text-right text-[10px] font-medium">{avance}%</span>
        </div>

        {/* Presupuesto consumido bar */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] text-muted-foreground shrink-0">Costo</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${semaforoBar}`}
              style={{ width: `${Math.min(consumo, 100)}%` }}
            />
          </div>
          <span className="w-10 text-right text-[10px] font-medium">{consumo}%</span>
        </div>
      </div>

      {/* Row 3: Ganancia real */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Ganancia actual</span>
        <span className={`text-xs font-semibold ${ganancia >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {ganancia >= 0 ? '+' : ''}{formatCOP(ganancia)}
        </span>
      </div>
    </Link>
  )
}
