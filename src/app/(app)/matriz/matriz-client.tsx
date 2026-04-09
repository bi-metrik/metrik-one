'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Riesgo } from '@/lib/actions/riesgos'

const NIVEL_COLORS: Record<string, string> = {
  BAJO: 'bg-green-100 text-green-800',
  MEDIO: 'bg-yellow-100 text-yellow-800',
  ALTO: 'bg-orange-100 text-orange-800',
  CRITICO: 'bg-red-100 text-red-800',
}

const CATEGORIA_COLORS: Record<string, string> = {
  LA: 'bg-blue-100 text-blue-800',
  FT: 'bg-purple-100 text-purple-800',
  FPADM: 'bg-amber-100 text-amber-800',
  PTEE: 'bg-red-100 text-red-800',
}

const PROB_LABELS: Record<number, string> = {
  1: 'Raro',
  2: 'Improbable',
  3: 'Posible',
  4: 'Probable',
  5: 'Casi seguro',
}

const IMPACTO_LABELS: Record<number, string> = {
  1: 'Insignificante',
  2: 'Menor',
  3: 'Moderado',
  4: 'Mayor',
  5: 'Catastrofico',
}

const FACTOR_LABELS: Record<string, string> = {
  clientes: 'Clientes',
  proveedores: 'Proveedores',
  empleados: 'Empleados',
  canales: 'Canales',
  jurisdicciones: 'Jurisdicciones',
  productos: 'Productos',
  operaciones: 'Operaciones',
}

const ESTADO_LABELS: Record<string, string> = {
  ABIERTO: 'Abierto',
  BAJO_CONTROL: 'Bajo control',
  MONITOREADO: 'Monitoreado',
  MITIGADO: 'Mitigado',
  REPORTADO: 'Reportado',
  CERRADO: 'Cerrado',
}

function getCellColor(prob: number, imp: number): string {
  const score = prob * imp
  if (score >= 20) return 'bg-red-200 hover:bg-red-300'
  if (score >= 12) return 'bg-orange-200 hover:bg-orange-300'
  if (score >= 6) return 'bg-yellow-200 hover:bg-yellow-300'
  return 'bg-green-200 hover:bg-green-300'
}

function getCellBorder(prob: number, imp: number, selectedCell: string | null): string {
  const key = `${prob}-${imp}`
  if (selectedCell === key) return 'ring-2 ring-[#10B981] ring-offset-1'
  return ''
}

const CATEGORIAS_FILTRO = [
  { value: 'todos', label: 'Todas' },
  { value: 'LA', label: 'LA' },
  { value: 'FT', label: 'FT' },
  { value: 'FPADM', label: 'FPADM' },
  { value: 'PTEE', label: 'PTEE' },
]

interface Props {
  riesgos: Riesgo[]
  categoriaFiltro: string
  celdaFiltro: string | null
}

export default function MatrizClient({ riesgos, categoriaFiltro, celdaFiltro }: Props) {
  const router = useRouter()
  const [selectedCell, setSelectedCell] = useState<string | null>(celdaFiltro)

  // Build 5x5 grid data
  const grid: Record<string, Riesgo[]> = {}
  for (let p = 1; p <= 5; p++) {
    for (let i = 1; i <= 5; i++) {
      grid[`${p}-${i}`] = []
    }
  }
  for (const r of riesgos) {
    const key = `${r.probabilidad}-${r.impacto}`
    if (grid[key]) grid[key].push(r)
  }

  // Counts by nivel
  const countByNivel = riesgos.reduce((acc, r) => {
    acc[r.nivel_riesgo] = (acc[r.nivel_riesgo] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Filtered riesgos for the table below
  const filteredRiesgos = selectedCell
    ? riesgos.filter(r => `${r.probabilidad}-${r.impacto}` === selectedCell)
    : riesgos

  function handleCellClick(prob: number, imp: number) {
    const key = `${prob}-${imp}`
    if (selectedCell === key) {
      setSelectedCell(null) // toggle off
    } else {
      setSelectedCell(key)
    }
  }

  function handleCategoriaChange(cat: string) {
    const params = new URLSearchParams()
    if (cat !== 'todos') params.set('categoria', cat)
    const qs = params.toString()
    router.push(`/matriz${qs ? `?${qs}` : ''}`)
    setSelectedCell(null)
  }

  return (
    <div className="space-y-6">
      {/* Summary + category filter */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <div className="text-sm font-medium text-[#1A1A1A]">
            {riesgos.length} riesgo{riesgos.length !== 1 ? 's' : ''}
          </div>
          {(['CRITICO', 'ALTO', 'MEDIO', 'BAJO'] as const).map(n => (
            <div key={n} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[n]}`}>
              {n}: {countByNivel[n] ?? 0}
            </div>
          ))}
        </div>
        <div className="flex gap-1">
          {CATEGORIAS_FILTRO.map(c => (
            <button
              key={c.value}
              onClick={() => handleCategoriaChange(c.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                categoriaFiltro === c.value
                  ? 'bg-[#10B981] text-white'
                  : 'bg-gray-100 text-[#6B7280] hover:bg-gray-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Matrix 5x5 */}
      <div className="overflow-x-auto">
        <div className="min-w-[480px]">
          {/* Y axis label */}
          <div className="flex">
            <div className="w-28 shrink-0" />
            <div className="flex-1 text-center text-xs font-semibold text-[#6B7280] pb-2">
              PROBABILIDAD
            </div>
          </div>

          <div className="flex">
            {/* Y axis */}
            <div className="w-28 shrink-0 flex flex-col items-center justify-center">
              <span className="text-xs font-semibold text-[#6B7280] -rotate-90 whitespace-nowrap">
                IMPACTO
              </span>
            </div>

            {/* Grid */}
            <div className="flex-1">
              {/* Column headers */}
              <div className="grid grid-cols-5 gap-1 mb-1">
                {[1, 2, 3, 4, 5].map(p => (
                  <div key={p} className="text-center text-[10px] font-medium text-[#6B7280]">
                    <div>{p}</div>
                    <div className="truncate">{PROB_LABELS[p]}</div>
                  </div>
                ))}
              </div>

              {/* Rows — impacto from 5 (top) to 1 (bottom) */}
              {[5, 4, 3, 2, 1].map(imp => (
                <div key={imp} className="flex items-center gap-1 mb-1">
                  <div className="w-0 flex-1 grid grid-cols-5 gap-1">
                    {[1, 2, 3, 4, 5].map(prob => {
                      const key = `${prob}-${imp}`
                      const count = grid[key]?.length ?? 0
                      return (
                        <button
                          key={key}
                          onClick={() => handleCellClick(prob, imp)}
                          className={`aspect-square rounded-md flex items-center justify-center text-sm font-bold transition-all ${getCellColor(prob, imp)} ${getCellBorder(prob, imp, selectedCell)}`}
                          title={`Prob: ${prob} (${PROB_LABELS[prob]}), Imp: ${imp} (${IMPACTO_LABELS[imp]}) — ${count} riesgo${count !== 1 ? 's' : ''}`}
                        >
                          {count > 0 ? count : ''}
                        </button>
                      )
                    })}
                  </div>
                  {/* Row label */}
                  <div className="w-24 shrink-0 text-right text-[10px] font-medium text-[#6B7280] pl-2">
                    {imp} - {IMPACTO_LABELS[imp]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Selected cell indicator */}
      {selectedCell && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#6B7280]">
            Filtrando: Probabilidad {selectedCell.split('-')[0]} ({PROB_LABELS[parseInt(selectedCell.split('-')[0])]}) x Impacto {selectedCell.split('-')[1]} ({IMPACTO_LABELS[parseInt(selectedCell.split('-')[1])]})
          </span>
          <button
            onClick={() => setSelectedCell(null)}
            className="text-xs font-medium text-[#10B981] hover:underline"
          >
            Quitar filtro
          </button>
        </div>
      )}

      {/* Table of filtered riesgos */}
      {filteredRiesgos.length === 0 ? (
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-8 text-center">
          <p className="text-sm text-[#6B7280]">
            {selectedCell ? 'No hay riesgos en esta celda.' : 'No hay riesgos registrados.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-[#6B7280]">
              <tr>
                <th className="px-4 py-3">Codigo</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3 min-w-[200px]">Descripcion</th>
                <th className="px-4 py-3">Factor</th>
                <th className="px-4 py-3 text-center">P</th>
                <th className="px-4 py-3 text-center">I</th>
                <th className="px-4 py-3">Nivel</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB] bg-white">
              {filteredRiesgos.map((r: Riesgo) => (
                <tr key={r.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/riesgos/${r.id}`} className="font-mono text-xs font-medium text-[#10B981] hover:underline">
                      {r.codigo ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[r.categoria] ?? ''}`}>
                      {r.categoria}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#1A1A1A]">
                    <Link href={`/riesgos/${r.id}`} className="hover:underline line-clamp-2">
                      {r.descripcion}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6B7280]">{FACTOR_LABELS[r.factor_riesgo] ?? r.factor_riesgo}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{r.probabilidad}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{r.impacto}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[r.nivel_riesgo] ?? ''}`}>
                      {r.nivel_riesgo}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6B7280]">{ESTADO_LABELS[r.estado] ?? r.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
