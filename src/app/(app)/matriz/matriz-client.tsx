'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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

// SARLAFT 5x5 lookup matrix
function getNivelFromCell(prob: number, imp: number): string {
  const key = prob * 10 + imp
  const extremo = [15, 25, 35, 45, 54, 55]
  const alto = [14, 24, 34, 43, 44, 53]
  const moderado = [13, 22, 23, 32, 33, 42, 52]
  if (extremo.includes(key)) return 'EXTREMO'
  if (alto.includes(key)) return 'ALTO'
  if (moderado.includes(key)) return 'MODERADO'
  return 'BAJO'
}

function getCellColor(prob: number, imp: number): string {
  const nivel = getNivelFromCell(prob, imp)
  if (nivel === 'EXTREMO') return 'bg-red-200 hover:bg-red-300'
  if (nivel === 'ALTO') return 'bg-orange-200 hover:bg-orange-300'
  if (nivel === 'MODERADO') return 'bg-yellow-200 hover:bg-yellow-300'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  causas: any[]
  categoriaFiltro: string
  celdaFiltro: string | null
}

export default function MatrizClient({ causas, categoriaFiltro, celdaFiltro }: Props) {
  const router = useRouter()
  const [selectedCell, setSelectedCell] = useState<string | null>(celdaFiltro)

  // Map each causa to grid cell
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const causasWithCell = causas.map((c: any) => {
    const prob = Math.max(1, Math.min(5, c.probabilidad ?? 1))
    const impRaw = parseFloat(c.impacto_ponderado ?? 1)
    const imp = Math.max(1, Math.min(5, Math.round(impRaw)))
    return { ...c, gridProb: prob, gridImp: imp }
  })

  // Build 5x5 grid
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grid: Record<string, any[]> = {}
  for (let p = 1; p <= 5; p++) {
    for (let i = 1; i <= 5; i++) {
      grid[`${p}-${i}`] = []
    }
  }
  for (const c of causasWithCell) {
    const key = `${c.gridProb}-${c.gridImp}`
    if (grid[key]) grid[key].push(c)
  }

  // Counts by nivel
  const countByNivel: Record<string, number> = { EXTREMO: 0, ALTO: 0, MODERADO: 0, BAJO: 0 }
  for (const c of causasWithCell) {
    const nivel = getNivelFromCell(c.gridProb, c.gridImp)
    countByNivel[nivel] = (countByNivel[nivel] || 0) + 1
  }

  const filteredCausas = selectedCell
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? causasWithCell.filter((c: any) => `${c.gridProb}-${c.gridImp}` === selectedCell)
    : causasWithCell

  function handleCellClick(prob: number, imp: number) {
    const key = `${prob}-${imp}`
    setSelectedCell(prev => prev === key ? null : key)
  }

  function handleCategoriaChange(cat: string) {
    const params = new URLSearchParams()
    if (cat !== 'todos') params.set('categoria', cat)
    const qs = params.toString()
    router.push(`/matriz${qs ? `?${qs}` : ''}`)
    setSelectedCell(null)
  }

  return (
    <div className="space-y-5">
      {/* Summary + category filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[#1A1A1A]">
            {causas.length} causa{causas.length !== 1 ? 's' : ''}
          </span>
          {(['EXTREMO', 'ALTO', 'MODERADO', 'BAJO'] as const).map(n => (
            <span key={n} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[n]}`}>
              {n}: {countByNivel[n] ?? 0}
            </span>
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

      {/* Compact 5x5 matrix */}
      <div className="mx-auto max-w-lg">
        {/* Column headers: PROBABILIDAD */}
        <div className="flex items-end gap-0.5 pl-20 pr-1 pb-1">
          {[1, 2, 3, 4, 5].map(p => (
            <div key={p} className="flex-1 text-center">
              <div className="text-[10px] font-bold text-[#6B7280]">{p}</div>
              <div className="text-[8px] text-[#6B7280] leading-tight truncate">{PROB_LABELS[p]}</div>
            </div>
          ))}
        </div>

        {/* Grid rows: 5→1 (top=high impact) */}
        <div className="flex">
          {/* Y-axis label */}
          <div className="w-5 shrink-0 flex items-center justify-center">
            <span className="text-[10px] font-semibold text-[#6B7280] -rotate-90 whitespace-nowrap tracking-wider">
              IMPACTO
            </span>
          </div>

          {/* Row labels + cells */}
          <div className="flex-1">
            {[5, 4, 3, 2, 1].map(imp => (
              <div key={imp} className="flex items-center gap-0.5 mb-0.5">
                {/* Row label left */}
                <div className="w-14 shrink-0 text-right pr-1.5">
                  <span className="text-[10px] font-medium text-[#6B7280]">{imp}</span>
                  <span className="text-[8px] text-[#6B7280] ml-0.5 hidden sm:inline">{IMPACTO_LABELS[imp]}</span>
                </div>
                {/* 5 cells */}
                {[1, 2, 3, 4, 5].map(prob => {
                  const key = `${prob}-${imp}`
                  const count = grid[key]?.length ?? 0
                  return (
                    <button
                      key={key}
                      onClick={() => handleCellClick(prob, imp)}
                      className={`flex-1 h-9 rounded flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${getCellColor(prob, imp)} ${getCellBorder(prob, imp, selectedCell)}`}
                      title={`P:${prob} (${PROB_LABELS[prob]}) × I:${imp} (${IMPACTO_LABELS[imp]}) — ${count} causa${count !== 1 ? 's' : ''} — ${getNivelFromCell(prob, imp)}`}
                    >
                      {count > 0 ? count : ''}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Axis label */}
        <div className="text-center text-[10px] font-semibold text-[#6B7280] tracking-wider pt-1 pl-20">
          PROBABILIDAD
        </div>
      </div>

      {/* Selected cell indicator */}
      {selectedCell && (
        <div className="flex items-center justify-center gap-2">
          <span className="text-xs text-[#6B7280]">
            Filtrando: Prob {selectedCell.split('-')[0]} ({PROB_LABELS[parseInt(selectedCell.split('-')[0])]}) × Imp {selectedCell.split('-')[1]} ({IMPACTO_LABELS[parseInt(selectedCell.split('-')[1])]})
            {' — '}
            <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${NIVEL_COLORS[getNivelFromCell(parseInt(selectedCell.split('-')[0]), parseInt(selectedCell.split('-')[1]))]}`}>
              {getNivelFromCell(parseInt(selectedCell.split('-')[0]), parseInt(selectedCell.split('-')[1]))}
            </span>
          </span>
          <button
            onClick={() => setSelectedCell(null)}
            className="text-xs font-medium text-[#10B981] hover:underline"
          >
            Quitar filtro
          </button>
        </div>
      )}

      {/* Table of filtered causas */}
      {filteredCausas.length === 0 ? (
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-8 text-center">
          <p className="text-sm text-[#6B7280]">
            {selectedCell ? 'No hay causas en esta celda.' : 'No hay causas registradas.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-[#6B7280]">
              <tr>
                <th className="px-4 py-2.5">Ref</th>
                <th className="px-4 py-2.5">Cat</th>
                <th className="px-4 py-2.5 min-w-[200px]">Causa</th>
                <th className="px-4 py-2.5">Factor</th>
                <th className="px-4 py-2.5 text-center">Prob</th>
                <th className="px-4 py-2.5 text-center">Imp</th>
                <th className="px-4 py-2.5">Nivel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB] bg-white">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {filteredCausas.map((c: any) => {
                const nivel = getNivelFromCell(c.gridProb, c.gridImp)
                return (
                  <tr key={c.id} className="transition-colors hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/riesgos/causa/${c.id}`} className="font-mono text-xs font-medium text-[#10B981] hover:underline">
                        {c.referencia ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[c.riesgo_categoria] ?? ''}`}>
                        {c.riesgo_categoria}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[#1A1A1A]">
                      <Link href={`/riesgos/causa/${c.id}`} className="hover:underline line-clamp-2">
                        {c.descripcion}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#6B7280] capitalize">{c.factor_riesgo ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-xs">{c.gridProb}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-xs">{c.gridImp}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[nivel] ?? ''}`}>
                        {nivel}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
