'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * Una alerta que pide una decisión (prototipo de la tarjeta, 2026-09-24): SOLO el ícono ⚠.
 * Al pasar el mouse dice de qué se trata (`tip`); al tocarlo abre el detalle y, si la hay, la
 * acción. No ocupa una franja: la tarjeta y la fila siguen leyéndose igual con o sin alertas.
 *
 * El detalle se cierra tocando fuera o con Escape.
 */
export function AlertaDecision({
  tip,
  children,
  izquierda = false,
}: {
  /** Lo que dice el ícono al pasar el mouse. */
  tip: string
  /** El detalle (texto y acción) que abre el ícono. */
  children: ReactNode
  /** Abre hacia la derecha: el ícono está en el borde izquierdo. */
  izquierda?: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const ancla = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!abierta) return
    function fuera(e: MouseEvent) {
      if (ancla.current && !ancla.current.contains(e.target as Node)) setAbierta(false)
    }
    function tecla(e: KeyboardEvent) { if (e.key === 'Escape') setAbierta(false) }
    document.addEventListener('mousedown', fuera)
    window.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      window.removeEventListener('keydown', tecla)
    }
  }, [abierta])

  const lado = izquierda ? 'left-0' : 'right-0'
  return (
    <span ref={ancla} className="group relative inline-flex shrink-0" data-alerta-decision>
      <button
        type="button"
        onClick={() => setAbierta(a => !a)}
        aria-expanded={abierta}
        aria-label="Necesita tu decisión"
        className="rounded-md border-0 bg-transparent p-1 leading-none text-[#9A5F0C] hover:bg-[#FBF1E2]"
      >
        <AlertTriangle className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
      </button>
      {!abierta && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute bottom-[calc(100%+6px)] ${lado} z-40 hidden w-max max-w-[240px] rounded-md bg-[#191713] px-2 py-1.5 text-left text-xs font-medium leading-[1.35] text-[#F3F1EC] [@media(hover:hover)]:group-hover:block`}
        >
          {tip}
        </span>
      )}
      {abierta && (
        <span
          role="dialog"
          className={`absolute top-[calc(100%+6px)] ${lado} z-[31] flex w-[min(300px,calc(100vw-40px))] flex-col gap-2 rounded-[10px] border border-[#E9C98F] bg-white p-3 text-[13px] text-[#191713] shadow-[0_10px_30px_rgba(0,0,0,.18)]`}
        >
          {children}
        </span>
      )}
    </span>
  )
}
