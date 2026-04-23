'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { WorkflowRow } from './actions'

const LINEAS = [
  { v: '', label: 'Todas las lineas' },
  { v: '20', label: '[20] Clarity' },
  { v: '21', label: '[21] ONE' },
  { v: '22', label: '[22] Analytics' },
  { v: '23', label: '[23] Projects' },
  { v: 'interno', label: 'Interno' },
]

const LINEA_LABELS: Record<string, string> = {
  '20': '[20] Clarity',
  '21': '[21] ONE',
  '22': '[22] Analytics',
  '23': '[23] Projects',
  'interno': 'Interno',
}

interface Props {
  workflows: WorkflowRow[]
  tags: string[]
}

export default function WorkflowsFilters({ workflows, tags }: Props) {
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

  const grouped = useMemo(() => {
    const g: Record<string, Record<string, Record<string, WorkflowRow[]>>> = {}
    for (const wf of filtered) {
      g[wf.cliente_slug] ??= {}
      g[wf.cliente_slug][wf.proyecto_slug] ??= {}
      g[wf.cliente_slug][wf.proyecto_slug][wf.linea_negocio] ??= []
      g[wf.cliente_slug][wf.proyecto_slug][wf.linea_negocio].push(wf)
    }
    return g
  }, [filtered])

  function toggleTag(t: string) {
    setActiveTags(prev => {
      const s = new Set(prev)
      if (s.has(t)) s.delete(t)
      else s.add(t)
      return s
    })
  }

  const clientes = Object.keys(grouped).sort()

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

      <div className="space-y-6">
        {clientes.map(cliente => (
          <section key={cliente} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <header className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
                {filtered.find(w => w.cliente_slug === cliente)?.cliente_nombre || cliente}
              </h2>
              <p className="text-[11px] text-gray-400">slug: {cliente}</p>
            </header>
            <div className="divide-y divide-gray-100">
              {Object.keys(grouped[cliente]).sort().map(proyecto => (
                <div key={proyecto} className="px-4 py-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Proyecto: {proyecto}
                  </p>
                  <div className="space-y-2">
                    {Object.keys(grouped[cliente][proyecto]).sort().map(lin => (
                      <div key={lin}>
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                          {LINEA_LABELS[lin] ?? lin}
                        </p>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {grouped[cliente][proyecto][lin].map(wf => (
                            <Link
                              key={wf.id}
                              href={`/admin/workflows/${wf.id}`}
                              className="group rounded-lg border border-gray-200 bg-white p-3 transition hover:border-[#10B981] hover:shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-[13px] font-semibold text-[#1A1A1A] group-hover:text-[#10B981]">
                                    {wf.nombre_flujo}
                                  </p>
                                  <p className="text-[11px] text-gray-400">
                                    v{wf.version} · {wf.total_fases ?? '?'} fases · {wf.total_etapas ?? '?'} etapas
                                  </p>
                                </div>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                                  wf.estado === 'vigente' ? 'bg-emerald-100 text-emerald-700' :
                                  wf.estado === 'listo_revision' ? 'bg-amber-100 text-amber-700' :
                                  wf.estado === 'archivado' ? 'bg-gray-200 text-gray-500' :
                                  'bg-blue-100 text-blue-700'
                                }`}>
                                  {wf.estado.replace('_', ' ')}
                                </span>
                              </div>
                              {wf.tags && wf.tags.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {wf.tags.slice(0, 4).map(t => (
                                    <span key={t} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-600">
                                      {t}
                                    </span>
                                  ))}
                                  {wf.tags.length > 4 && (
                                    <span className="text-[9px] text-gray-400">+{wf.tags.length - 4}</span>
                                  )}
                                </div>
                              )}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
