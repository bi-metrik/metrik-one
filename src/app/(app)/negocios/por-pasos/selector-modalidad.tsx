'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { cambiarModalidadDelViaje } from '@/app/(app)/negocios/modalidad-actions'
import type { ValorModalidad } from '@/lib/cotizaciones/modalidad-campo'

const OPCIONES: { valor: ValorModalidad; etiqueta: string }[] = [
  { valor: 'a_medida', etiqueta: 'A medida' },
  { valor: 'bloqueo', etiqueta: 'Bloqueo' },
]

/**
 * «Modalidad: A medida | Bloqueo» en la cotización (Tatiana, 2026-11-03): cambiarla sin salir a
 * «Condiciones del viaje». Escribe con `cambiarModalidadDelViaje` (mismo guard y traza que la marca de
 * la bandeja) y al volver refresca la página, que trae el bloqueo nuevo (paquetes, vuelo sin precio,
 * precios por persona). Solo se monta si el negocio tiene el campo (`campoModalidad`). Vacío = A medida.
 */
export function SelectorModalidad({
  cotizacionId,
  valor,
  editable,
  onCambio,
  cambiar = cambiarModalidadDelViaje,
}: {
  cotizacionId: string
  valor: ValorModalidad | ''
  editable: boolean
  onCambio: () => void
  /** Para la prueba. */
  cambiar?: typeof cambiarModalidadDelViaje
}) {
  const [elegido, setElegido] = useState<ValorModalidad>(valor || 'a_medida')
  const [pendiente, empezar] = useTransition()
  // Lo que trae el refresco manda (ajuste en render, no en un efecto).
  const [base, setBase] = useState(valor)
  if (base !== valor) {
    setBase(valor)
    setElegido(valor || 'a_medida')
  }

  function elegir(v: ValorModalidad) {
    if (!editable || pendiente || v === elegido) return
    const previo = elegido
    setElegido(v)
    empezar(async () => {
      const r = await cambiar(cotizacionId, v).catch(() => ({ success: false as const, error: 'No se pudo cambiar la modalidad. Vuelve a intentarlo.' }))
      if (!r.success) {
        setElegido(previo)
        toast.error(r.error)
        return
      }
      onCambio()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]" data-selector-modalidad>
      <span className="font-semibold text-[#1A1A1A]" id="etiqueta-modalidad">Modalidad:</span>
      <div role="radiogroup" aria-labelledby="etiqueta-modalidad" className="inline-flex overflow-hidden rounded-md border border-[#D9D5CC]">
        {OPCIONES.map(o => {
          const activo = elegido === o.valor
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={activo}
              disabled={!editable || pendiente}
              data-modalidad={o.valor}
              onClick={() => elegir(o.valor)}
              className={`h-7 px-3 font-semibold disabled:cursor-default ${activo ? 'bg-[#0E5C43] text-white' : 'bg-white text-[#6E6A62] hover:bg-[#F3F8F5]'} ${pendiente ? 'opacity-60' : ''}`}
            >
              {o.etiqueta}
            </button>
          )
        })}
      </div>
    </div>
  )
}
