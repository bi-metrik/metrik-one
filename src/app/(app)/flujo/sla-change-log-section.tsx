'use client'

import { useEffect, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { getSlaChangeLog, type SlaLogEntry } from './actions'

function formatSlaValue(h: number | null): string {
  if (h === null) return 'Sin alerta'
  if (h >= 24 && h % 24 === 0) {
    const d = h / 24
    return `${h}h (${d} día${d === 1 ? '' : 's'} hábil${d === 1 ? '' : 'es'})`
  }
  return `${h}h`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function SlaChangeLogSection({ lineaId }: { lineaId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [entries, setEntries] = useState<SlaLogEntry[] | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!expanded) return
    if (entries !== null) return
    startTransition(async () => {
      const data = await getSlaChangeLog(lineaId, 50)
      setEntries(data)
    })
  }, [expanded, entries, lineaId])

  return (
    <section
      className="mt-8 overflow-hidden rounded-xl border bg-white"
      style={{ borderColor: '#E5E7EB' }}
    >
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-[#F5F4F2]"
      >
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[#6B7280]" />
          <span className="text-sm font-semibold text-[#1A1A1A]">
            Historial de cambios SLA
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[#6B7280]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#6B7280]" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-[#E5E7EB]">
          {isPending && entries === null ? (
            <p className="px-4 py-6 text-sm text-[#6B7280]">Cargando…</p>
          ) : entries === null || entries.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[#6B7280]">
              Aún no se han registrado cambios al SLA en esta línea.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F5F4F2] text-[11px] uppercase tracking-wider text-[#6B7280]">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Fecha</th>
                    <th className="px-4 py-2 text-left font-semibold">Usuario</th>
                    <th className="px-4 py-2 text-left font-semibold">Etapa</th>
                    <th className="px-4 py-2 text-left font-semibold">Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-t"
                      style={{ borderColor: '#E5E7EB' }}
                    >
                      <td className="px-4 py-2 align-top text-[12px] text-[#1A1A1A]">
                        {formatDate(entry.changed_at)}
                      </td>
                      <td className="px-4 py-2 align-top text-[12px] text-[#1A1A1A]">
                        {entry.user_name ?? '—'}
                      </td>
                      <td className="px-4 py-2 align-top text-[12px] text-[#1A1A1A]">
                        {entry.etapa_nombre}
                      </td>
                      <td className="px-4 py-2 align-top text-[12px] text-[#1A1A1A]">
                        <span className="text-[#6B7280]">
                          {formatSlaValue(entry.old_sla_horas)}
                        </span>{' '}
                        <span className="text-[#6B7280]">→</span>{' '}
                        <span className="font-semibold">
                          {formatSlaValue(entry.new_sla_horas)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
