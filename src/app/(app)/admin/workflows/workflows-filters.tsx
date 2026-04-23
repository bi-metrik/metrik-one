'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { WorkflowRow } from './actions'

interface Props {
  workflows: WorkflowRow[]
}

export default function WorkflowsFilters({ workflows }: Props) {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    if (!q.trim()) return workflows
    const s = q.trim().toLowerCase()
    return workflows.filter(w => {
      const hay = `${w.nombre_flujo} ${w.cliente_slug} ${w.cliente_nombre ?? ''} ${w.proyecto_slug} ${w.linea_negocio_cliente ?? ''}`.toLowerCase()
      return hay.includes(s)
    })
  }, [workflows, q])

  // Agrupar por cliente → proyecto → linea del cliente
  const grouped = useMemo(() => {
    const g: Record<string, Record<string, Record<string, WorkflowRow[]>>> = {}
    for (const wf of filtered) {
      const linea = wf.linea_negocio_cliente || '(sin linea)'
      g[wf.cliente_slug] ??= {}
      g[wf.cliente_slug][wf.proyecto_slug] ??= {}
      g[wf.cliente_slug][wf.proyecto_slug][linea] ??= []
      g[wf.cliente_slug][wf.proyecto_slug][linea].push(wf)
    }
    return g
  }, [filtered])

  const clientes = Object.keys(grouped).sort()

  return (
    <div>
      <div className="mb-5">
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nombre, cliente, proyecto, linea…"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-[#10B981] focus:outline-none"
        />
      </div>
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
                          {lin}
                        </p>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {grouped[cliente][proyecto][lin].map(wf => {
                            const ident = wf.numero_flujo ? `${wf.cliente_slug}${wf.numero_flujo}` : wf.cliente_slug
                            const displayName = wf.linea_negocio_cliente
                              ? `${ident} - ${wf.linea_negocio_cliente}`
                              : `${ident} - ${wf.nombre_flujo}`
                            return (
                              <Link
                                key={wf.id}
                                href={`/admin/workflows/${wf.id}`}
                                className="group rounded-lg border border-gray-200 bg-white p-3 transition hover:border-[#10B981] hover:shadow-sm"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-[13px] font-semibold text-[#1A1A1A] group-hover:text-[#10B981]">
                                      {displayName}
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
                              </Link>
                            )
                          })}
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
