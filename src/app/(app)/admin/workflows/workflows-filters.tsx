'use client'

import { useState, useMemo } from 'react'
import type { WorkflowRow } from './actions'

const LINEAS = [
  { v: '', label: 'Todas las lineas' },
  { v: '20', label: '[20] Clarity' },
  { v: '21', label: '[21] ONE' },
  { v: '22', label: '[22] Analytics' },
  { v: '23', label: '[23] Projects' },
  { v: 'interno', label: 'Interno' },
]

interface Props {
  workflows: WorkflowRow[]
  tags: string[]
  children: (filtered: WorkflowRow[]) => React.ReactNode
}

export default function WorkflowsFilters({ workflows, tags, children }: Props) {
  const [q, setQ] = useState('')
  const [linea, setLinea] = useState('')
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    return workflows.filter(w => {
      if (linea && w.linea_negocio !== linea) return false
      if (activeTags.size > 0) {
        const wfTags = new Set(w.tags ?? [])
        for (const t of activeTags) {
          if (!wfTags.has(t)) return false
        }
      }
      if (q.trim()) {
        const s = q.trim().toLowerCase()
        const hay = `${w.nombre_flujo} ${w.cliente_slug} ${w.cliente_nombre ?? ''} ${w.proyecto_slug} ${(w.tags ?? []).join(' ')}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [workflows, q, linea, activeTags])

  function toggleTag(t: string) {
    setActiveTags(prev => {
      const s = new Set(prev)
      if (s.has(t)) s.delete(t)
      else s.add(t)
      return s
    })
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-3">
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nombre, cliente, proyecto…"
          className="min-w-[220px] flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-[#10B981] focus:outline-none"
        />
        <select
          value={linea}
          onChange={e => setLinea(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-[#10B981] focus:outline-none"
        >
          {LINEAS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
        </select>
      </div>
      {tags.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {tags.map(t => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                activeTags.has(t)
                  ? 'border-[#10B981] bg-[#10B981] text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              {t}
            </button>
          ))}
          {activeTags.size > 0 && (
            <button
              onClick={() => setActiveTags(new Set())}
              className="text-[11px] text-gray-400 underline hover:text-gray-600"
            >
              limpiar
            </button>
          )}
        </div>
      )}
      <p className="mb-4 text-xs text-gray-400">
        {filtered.length} de {workflows.length} workflows
      </p>
      {children(filtered)}
    </div>
  )
}
