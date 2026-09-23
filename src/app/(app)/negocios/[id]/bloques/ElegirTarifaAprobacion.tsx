'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, X } from 'lucide-react'

/** Una tarifa como la ofrece «Aprobar». La forma de `TarifaParaAprobar`. */
export interface TarifaOpcion {
  itinerarioId: string
  nombre: string | null
  esRecomendada: boolean
  /** Lo que queda en `precio_aprobado` si la escogen. `null` = su IVA no se pudo calcular. */
  precio: number | null
  motivo: string | null
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

/**
 * La pregunta de «Aprobar» cuando la cotización tiene tarifas: ¿cuál escogió el cliente?
 * (decisión de Mauricio del 2026-09-22).
 *
 * El documento lleva el TOTAL de la Recomendada, pero el cliente puede tomar otra; la que
 * se escoja aquí fija `precio_aprobado`. Cada opción muestra el precio que dejaría, el
 * MISMO que escribe el servidor (IVA incluido si aplica), para que nadie apruebe a
 * ciegas. Una tarifa sin precio calculable se muestra, pero no se puede escoger, y dice
 * por qué.
 *
 * ⚠️ `createPortal` a `document.body`: montado dentro de la página, un `fixed inset-0`
 * queda atrapado por cualquier ancestro con `backdrop-blur` (ya pasó tres veces con el
 * encabezado del negocio).
 *
 * `enPortal={false}` solo para la prueba de render, que no tiene DOM.
 */
export default function ElegirTarifaAprobacion({
  tarifas,
  elegida,
  onElegir,
  onConfirmar,
  onCancelar,
  pendiente,
  enPortal = true,
}: {
  tarifas: TarifaOpcion[]
  elegida: string | null
  onElegir: (itinerarioId: string) => void
  onConfirmar: () => void
  onCancelar: () => void
  pendiente: boolean
  enPortal?: boolean
}) {
  useEffect(() => {
    if (!enPortal) return
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar() }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [enPortal, onCancelar])

  const seleccionada = tarifas.find(t => t.itinerarioId === elegida) ?? null
  const puedeConfirmar = !pendiente && seleccionada !== null && seleccionada.precio !== null

  const contenido = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancelar}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="elegir-tarifa-titulo"
        className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl dark:bg-neutral-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 id="elegir-tarifa-titulo" className="text-sm font-semibold text-tinta">
              ¿Qué tarifa escogió el cliente?
            </h3>
            <p className="mt-0.5 text-[11px] text-tinta-suave">
              Su precio queda como precio aprobado del negocio. El documento siguió mostrando el
              total de la Recomendada; si el cliente escogió otra, aquí es donde se dice.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelar}
            className="rounded p-1 text-tinta-suave hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 space-y-1.5" role="radiogroup" aria-label="Tarifas de la propuesta">
          {tarifas.map(t => {
            const activa = t.itinerarioId === elegida
            const bloqueada = t.precio === null
            return (
              <label
                key={t.itinerarioId}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${
                  activa ? 'border-green-400 bg-green-50/60' : 'border-[#E5E7EB] hover:border-slate-300'
                } ${bloqueada ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="tarifa-aprobada"
                  value={t.itinerarioId}
                  checked={activa}
                  disabled={bloqueada || pendiente}
                  onChange={() => onElegir(t.itinerarioId)}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-tinta">
                    {t.nombre?.trim() || 'Sin nombre'}
                    {t.esRecomendada && (
                      <span className="rounded-full bg-pink-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-pink-700">
                        Recomendada
                      </span>
                    )}
                  </span>
                  {bloqueada ? (
                    <span className="mt-0.5 block text-[10px] text-red-600">{t.motivo ?? 'Su precio no se pudo calcular'}</span>
                  ) : (
                    <span className="mt-0.5 block text-[11px] tabular-nums text-tinta-suave">{fmt(t.precio as number)}</span>
                  )}
                </span>
              </label>
            )
          })}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={pendiente}
            className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs font-medium text-tinta-suave hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={!puedeConfirmar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {seleccionada ? `Aprobar con ${seleccionada.nombre?.trim() || 'esta tarifa'}` : 'Escoge una tarifa'}
          </button>
        </div>
      </div>
    </div>
  )

  if (!enPortal) return contenido
  return typeof document === 'undefined' ? null : createPortal(contenido, document.body)
}
