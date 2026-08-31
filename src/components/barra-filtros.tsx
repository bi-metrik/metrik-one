'use client'
import { useState, type ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import {
  camposActivos,
  camposVisibles,
  etiquetaValor,
  type CampoFiltro,
} from '@/lib/filtros/campos'

/**
 * Barra de filtros secundarios de las listas.
 *
 * Nació en `/negocios`, donde los cuatro desplegables (seccional, origen,
 * servicio, responsable) se apilaban a ancho completo uno debajo del otro y
 * empujaban el primer negocio fuera de la pantalla del celular. El problema no
 * era cuántos filtros hay sino que todos pesaban igual: los cuatro se usan de
 * vez en cuando, pero ocupaban más alto que la lista que filtran.
 *
 * Se resuelve con dos piezas:
 *  - Un botón que colapsa los desplegables y lleva el número de filtros puestos.
 *  - Chips de lo que está filtrando ahora mismo, cada uno con su X.
 *
 * Los chips son la parte que no se puede quitar: esconder un filtro sin decir
 * que está puesto es peor que mostrarlo siempre, porque el usuario ve una lista
 * corta y no entiende por qué. Con los chips visibles, el panel puede vivir
 * cerrado sin que nadie se pierda.
 *
 * Solo dibuja los controles. Qué filtra cada campo lo decide cada lista.
 */

export default function BarraFiltros({
  campos,
  children,
}: {
  campos: CampoFiltro[]
  /** Controles que comparten fila con el botón (atrasados, orden). */
  children?: ReactNode
}) {
  const visibles = camposVisibles(campos)
  const activos = camposActivos(campos)
  const [abierto, setAbierto] = useState(false)

  if (visibles.length === 0 && !children) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {visibles.length > 0 && (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            aria-controls="panel-filtros"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              abierto || activos.length > 0
                ? 'border-[#1A1A1A]/30 bg-[#F5F4F2] text-[#1A1A1A]'
                : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A]'
            }`}
          >
            <SlidersHorizontal className="h-3 w-3" />
            Filtros
            {activos.length > 0 && (
              <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold">
                {activos.length}
              </span>
            )}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${abierto ? 'rotate-180' : ''}`}
            />
          </button>
        )}
        {children}
      </div>

      {/* Lo que está filtrando ahora mismo. Se ve con el panel abierto o cerrado. */}
      {activos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activos.map((c) => (
            <button
              key={c.clave}
              type="button"
              onClick={() => c.onChange(c.porDefecto)}
              aria-label={`Quitar filtro de ${c.etiqueta.toLowerCase()}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#1A1A1A]/20 bg-[#F5F4F2] px-2.5 py-1 text-xs text-[#1A1A1A] transition-colors hover:border-[#1A1A1A]/40"
            >
              <span className="text-[#6B7280]">{c.etiqueta}:</span>
              {etiquetaValor(c)}
              <X className="h-3 w-3 text-[#6B7280]" />
            </button>
          ))}
          {activos.length > 1 && (
            <button
              type="button"
              onClick={() => activos.forEach((c) => c.onChange(c.porDefecto))}
              className="shrink-0 rounded-full px-2 py-1 text-xs text-[#6B7280] underline-offset-2 transition-colors hover:text-[#1A1A1A] hover:underline"
            >
              Limpiar
            </button>
          )}
        </div>
      )}

      {abierto && visibles.length > 0 && (
        <div id="panel-filtros" className="grid gap-2 sm:grid-cols-2">
          {visibles.map((c) => (
            <div key={c.clave}>
              <label
                htmlFor={`filtro-${c.clave}`}
                className="mb-1 block text-[11px] font-medium text-[#6B7280]"
              >
                {c.etiqueta}
              </label>
              <select
                id={`filtro-${c.clave}`}
                value={c.valor}
                onChange={(e) => c.onChange(e.target.value)}
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#1A1A1A]/30 focus:outline-none"
              >
                <option value={c.porDefecto}>{c.etiquetaTodos}</option>
                {c.opciones.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                    {o.count !== undefined ? ` (${o.count})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
