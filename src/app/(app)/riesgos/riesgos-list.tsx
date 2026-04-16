'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ShieldCheck, ShieldAlert } from 'lucide-react'

const NIVEL_COLORS: Record<string, string> = {
  BAJO: 'bg-green-100 text-green-800',
  MODERADO: 'bg-yellow-100 text-yellow-800',
  ALTO: 'bg-orange-100 text-orange-800',
  EXTREMO: 'bg-red-100 text-red-800',
}

const CATEGORIA_COLORS: Record<string, string> = {
  LA: 'bg-blue-100 text-blue-800',
  FT: 'bg-purple-100 text-purple-800',
  FPADM: 'bg-amber-100 text-amber-800',
  PTEE: 'bg-red-100 text-red-800',
}

const PROB_COLORS: Record<number, string> = {
  1: 'bg-green-100 text-green-800',
  2: 'bg-yellow-100 text-yellow-800',
  3: 'bg-orange-100 text-orange-800',
  4: 'bg-red-100 text-red-700',
  5: 'bg-red-200 text-red-900',
}

function getImpactoBadgeColor(value: number): string {
  if (value <= 1.5) return 'bg-green-100 text-green-800'
  if (value <= 2.5) return 'bg-yellow-100 text-yellow-800'
  if (value <= 3.5) return 'bg-orange-100 text-orange-800'
  return 'bg-red-100 text-red-800'
}

interface RiesgoHeader {
  id: string
  codigo: string | null
  categoria: string
  descripcion: string
  nivel_riesgo: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Props {
  riesgos: RiesgoHeader[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  causasByRiesgo: Record<string, any[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlesByCausaId: Record<string, any[]>
}

export default function RiesgosList({ riesgos, causasByRiesgo, controlesByCausaId }: Props) {
  // All expanded by default
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggleRiesgo(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (riesgos.length === 0) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-12 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-[#6B7280] mb-3" />
        <p className="text-sm font-medium text-[#1A1A1A]">Sin riesgos registrados</p>
        <p className="mt-1 text-xs text-[#6B7280]">Agrega el primer riesgo para comenzar la matriz.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {riesgos.map(r => {
        const rCausas = causasByRiesgo[r.id] ?? []
        const isCollapsed = collapsed.has(r.id)

        return (
          <div key={r.id} className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
            {/* Collapsible header */}
            <button
              onClick={() => toggleRiesgo(r.id)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors border-b border-[#E5E7EB] text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-[#6B7280] shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[#6B7280] shrink-0" />
                )}
                <span className="font-mono text-xs font-bold text-[#10B981]">{r.codigo ?? '—'}</span>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[r.categoria] ?? ''}`}>
                  {r.categoria}
                </span>
                <span className="text-sm font-medium text-[#1A1A1A] line-clamp-1">{r.descripcion}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[r.nivel_riesgo] ?? ''}`}>
                  {r.nivel_riesgo}
                </span>
                <span className="text-xs text-[#6B7280]">{rCausas.length} causa{rCausas.length !== 1 ? 's' : ''}</span>
              </div>
            </button>

            {/* Causas table — hidden when collapsed */}
            {!isCollapsed && rCausas.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[10px] font-medium uppercase tracking-wider text-[#6B7280] bg-white">
                    <tr>
                      <th className="px-4 py-2">Ref</th>
                      <th className="px-4 py-2 min-w-[200px]">Causa</th>
                      <th className="px-4 py-2">Factor</th>
                      <th className="px-4 py-2 text-center">Imp.</th>
                      <th className="px-4 py-2 text-center">Prob</th>
                      <th className="px-4 py-2 text-center">Control</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {rCausas.map((c: any) => {
                      const impPonderado = parseFloat(c.impacto_ponderado ?? 0)
                      const controles = controlesByCausaId[c.id] ?? []
                      return (
                        <tr key={c.id} className="transition-colors hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <Link href={`/riesgos/causa/${c.id}`} className="font-mono text-xs font-medium text-[#10B981] hover:underline">
                              {c.referencia}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5">
                            <Link href={`/riesgos/causa/${c.id}`} className="hover:underline">
                              <p className="text-[#1A1A1A] line-clamp-2 text-sm">{c.descripcion}</p>
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-[#6B7280] capitalize">{c.factor_riesgo ?? '—'}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${getImpactoBadgeColor(impPonderado)}`}>
                              {impPonderado.toFixed(1)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${PROB_COLORS[c.probabilidad ?? 1] ?? 'bg-gray-100 text-gray-800'}`}>
                              {c.probabilidad ?? 1}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {controles.length > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">
                                <ShieldCheck className="h-3 w-3" />
                                {controles.length}
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
                                Sin control
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!isCollapsed && rCausas.length === 0 && (
              <div className="px-4 py-4 text-center">
                <p className="text-xs text-[#6B7280] italic">Sin causas identificadas para este evento</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
