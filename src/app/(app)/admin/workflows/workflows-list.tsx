'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { AdminLineaItem } from './actions'

interface Props {
  items: AdminLineaItem[]
}

export default function WorkflowsList({ items }: Props) {
  const [q, setQ] = useState('')
  const [filterWorkspace, setFilterWorkspace] = useState<string>('todos')
  const [filterTipo, setFilterTipo] = useState<string>('todos')
  const [filterEstado, setFilterEstado] = useState<string>('todos')

  const tipos = useMemo(() => Array.from(new Set(items.map(i => i.linea_tipo))).sort(), [items])
  const workspaceOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of items) {
      const key = it.workspace_slug || it.workspace_id
      const label = it.workspace_name || it.workspace_slug || it.workspace_id
      if (!map.has(key)) map.set(key, label)
    }
    return Array.from(map.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items])

  const filtered = useMemo(() => {
    return items.filter(it => {
      if (filterWorkspace !== 'todos') {
        const key = it.workspace_slug || it.workspace_id
        if (key !== filterWorkspace) return false
      }
      if (filterTipo !== 'todos' && it.linea_tipo !== filterTipo) return false
      if (filterEstado === 'activo' && !it.is_active) return false
      if (filterEstado === 'inactivo' && it.is_active) return false
      if (q.trim()) {
        const s = q.trim().toLowerCase()
        const hay = `${it.linea_nombre} ${it.workspace_slug ?? ''} ${it.workspace_name ?? ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [items, q, filterWorkspace, filterTipo, filterEstado])

  const grouped = useMemo(() => {
    const g: Record<string, AdminLineaItem[]> = {}
    for (const it of filtered) {
      const key = it.workspace_slug || it.workspace_id
      g[key] ??= []
      g[key].push(it)
    }
    return g
  }, [filtered])

  const workspaces = Object.keys(grouped).sort()

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por línea, workspace…"
          className="flex-1 min-w-[240px] rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm focus:border-acento focus:outline-none focus:ring-2 focus:ring-acento/15"
        />
        <select
          value={filterWorkspace}
          onChange={e => setFilterWorkspace(e.target.value)}
          className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm focus:border-acento focus:outline-none"
        >
          <option value="todos">Todos los workspaces</option>
          {workspaceOptions.map(w => <option key={w.slug} value={w.slug}>{w.name}</option>)}
        </select>
        <select
          value={filterTipo}
          onChange={e => setFilterTipo(e.target.value)}
          className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm focus:border-acento focus:outline-none"
        >
          <option value="todos">Todos los tipos</option>
          {tipos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterEstado}
          onChange={e => setFilterEstado(e.target.value)}
          className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm focus:border-acento focus:outline-none"
        >
          <option value="todos">Activos e inactivos</option>
          <option value="activo">Solo activos</option>
          <option value="inactivo">Solo inactivos</option>
        </select>
      </div>
      <p className="mb-4 text-xs text-tinta-suave">
        {filtered.length} de {items.length} flujos
      </p>

      <div className="space-y-4">
        {workspaces.map(ws => {
          const lineas = grouped[ws]
          const wsName = lineas[0]?.workspace_name || ws
          return (
            <section key={ws} className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
              <header className="border-b border-[#E5E7EB] bg-papel px-4 py-2.5">
                <h2 className="text-sm font-bold text-tinta">{wsName}</h2>
                <p className="text-[11px] text-tinta-suave">slug: {ws}</p>
              </header>
              <div className="divide-y divide-[#E5E7EB]">
                {lineas.map(l => (
                  <Link
                    key={l.linea_id}
                    href={`/admin/workflows/${l.workspace_id}/${l.linea_id}`}
                    className="group block px-4 py-3 transition hover:bg-papel"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-tinta group-hover:text-acento">
                          {l.linea_nombre}
                        </p>
                        <p className="text-[11px] text-tinta-suave">
                          {l.total_etapas} etapa{l.total_etapas === 1 ? '' : 's'} · {l.total_bloques} bloque{l.total_bloques === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-full bg-papel px-2 py-0.5 text-[10px] font-medium text-tinta-suave">
                          {l.linea_tipo}
                        </span>
                        {!l.is_active && (
                          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                            inactiva
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
