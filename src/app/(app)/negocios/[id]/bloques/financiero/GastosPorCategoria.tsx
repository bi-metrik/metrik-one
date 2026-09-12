'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { CATEGORIA_LABELS, fmt, fmtFecha } from './formato'

/** Un gasto tal como se lista al abrir su categoría. */
export interface MovimientoGasto {
  id: string
  descripcion: string | null
  monto: number
  fecha: string
}

export interface CategoriaGasto {
  categoria: string
  total: number
  /** Cada categoría trae los movimientos que la forman: la fila se abre sin ir a otra pantalla. */
  movimientos?: MovimientoGasto[]
}

interface Props {
  categorias: CategoriaGasto[]
  totalGastos: number
  titulo?: string
}

/**
 * Los egresos del negocio, agrupados por categoría y abribles fila por fila.
 *
 * Vive aparte porque responde una pregunta de MOVIMIENTO ("¿en qué se fue la plata?")
 * y no de resultado. El bloque de Ejecución la sigue usando tal cual; el bloque de
 * Movimientos la usa como su columna de salidas.
 */
export default function GastosPorCategoria({ categorias, totalGastos, titulo = 'Gastos por categoría' }: Props) {
  // Qué categorías están abiertas. Varias a la vez: comparar dos categorías es el uso
  // normal, y un acordeón de una sola obliga a cerrar la que se estaba mirando.
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const toggleCategoria = (categoria: string) =>
    setAbiertas(prev => {
      const next = new Set(prev)
      if (!next.delete(categoria)) next.add(categoria)
      return next
    })

  if (categorias.length === 0) return null

  return (
    <div>
      <p className="text-[10px] font-medium text-tinta-suave mb-1.5">{titulo}</p>
      <div className="space-y-1">
        {categorias.map(g => {
          const pct = totalGastos > 0 ? Math.round((g.total / totalGastos) * 100) : 0
          const movimientos = g.movimientos ?? []
          const abierta = abiertas.has(g.categoria)
          // Sin movimientos la fila no se abre: un acordeón que despliega vacío se lee
          // como un error de la pantalla, no como "esta categoría no trae detalle".
          const puedeAbrir = movimientos.length > 0
          return (
            <div key={g.categoria}>
              <div
                className={`flex items-center gap-2 rounded ${puedeAbrir ? 'cursor-pointer hover:bg-black/[0.03]' : ''}`}
                onClick={puedeAbrir ? () => toggleCategoria(g.categoria) : undefined}
                role={puedeAbrir ? 'button' : undefined}
                tabIndex={puedeAbrir ? 0 : undefined}
                aria-expanded={puedeAbrir ? abierta : undefined}
                onKeyDown={puedeAbrir ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleCategoria(g.categoria)
                  }
                } : undefined}
              >
                <span className="flex items-center gap-0.5 text-[10px] text-tinta-suave w-28 truncate">
                  {puedeAbrir && (
                    <ChevronRight
                      className={`h-2.5 w-2.5 shrink-0 transition-transform ${abierta ? 'rotate-90' : ''}`}
                    />
                  )}
                  <span className="truncate">{CATEGORIA_LABELS[g.categoria] ?? g.categoria}</span>
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] font-medium text-tinta-suave tabular-nums w-20 text-right">
                  {fmt(g.total)}
                </span>
              </div>

              {abierta && (
                <ul className="mb-1.5 mt-1 ml-3 space-y-1 border-l border-[#E5E7EB] pl-2">
                  {movimientos.map(m => (
                    <li key={m.id} className="flex items-start gap-2">
                      <span className="w-10 shrink-0 text-[10px] text-tinta-suave tabular-nums">
                        {fmtFecha(m.fecha)}
                      </span>
                      <span className="flex-1 break-words text-[10px] text-tinta">
                        {m.descripcion || 'Sin descripción'}
                      </span>
                      <span className="w-20 shrink-0 text-right text-[10px] text-tinta-suave tabular-nums">
                        {fmt(m.monto)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
