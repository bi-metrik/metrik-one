'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * «Deshacer (8)» de la cotización por pasos (decisión G del diseño; criterios D1 y D2).
 *
 * El cambio YA se escribió y el total YA se recalculó cuando aparece el aviso: aquí no se espera
 * nada para escribir (a diferencia de `espera-deshacer.ts`, que escribía al vencer). «Deshacer»
 * llama a la escritura de vuelta, que el servidor solo aplica si nadie cambió el campo en medio.
 *
 * Un solo aviso a la vez: uno nuevo reemplaza al anterior (y el anterior «vence» en ese momento:
 * su pantallazo vuelve a la bandeja, sus imágenes se sueltan).
 */

export const SEGUNDOS_DESHACER = 8

interface Oferta {
  clave: number
  mensaje: string
  deshacer: () => Promise<{ success: boolean; error?: string }>
  alVencer?: () => void
}

export function useDeshacer(onDeshecho: () => void) {
  const [oferta, setOferta] = useState<Oferta | null>(null)
  const [quedan, setQuedan] = useState(SEGUNDOS_DESHACER)
  const [ocupado, setOcupado] = useState(false)
  const actual = useRef<Oferta | null>(null)
  const reloj = useRef<ReturnType<typeof setInterval> | null>(null)
  const secuencia = useRef(0)

  const vencer = useCallback(() => {
    if (reloj.current) clearInterval(reloj.current)
    reloj.current = null
    const o = actual.current
    actual.current = null
    setOferta(null)
    o?.alVencer?.()
  }, [])

  // Al salir de la cotización, lo pendiente vence (el pantallazo vuelve a la bandeja de esta
  // pestaña no tiene a dónde volver, pero las imágenes sí se sueltan).
  useEffect(() => () => {
    if (reloj.current) clearInterval(reloj.current)
    actual.current?.alVencer?.()
  }, [])

  const ofrecer = useCallback((mensaje: string, deshacer: Oferta['deshacer'], alVencer?: () => void) => {
    if (actual.current) vencer()
    const o: Oferta = { clave: ++secuencia.current, mensaje, deshacer, alVencer }
    actual.current = o
    setOferta(o)
    setQuedan(SEGUNDOS_DESHACER)
    let n = SEGUNDOS_DESHACER
    reloj.current = setInterval(() => {
      n -= 1
      if (n <= 0) vencer()
      else setQuedan(n)
    }, 1000)
  }, [vencer])

  const pulsar = useCallback(async () => {
    const o = actual.current
    if (!o || ocupado) return
    if (reloj.current) clearInterval(reloj.current)
    reloj.current = null
    setOcupado(true)
    const r = await o.deshacer().catch(() => ({ success: false, error: 'No se pudo deshacer: revisa la conexión.' }))
    setOcupado(false)
    actual.current = null
    setOferta(null)
    if (r.success) {
      toast.success('Deshecho.')
      onDeshecho()
    } else {
      toast.error(r.error ?? 'No se pudo deshacer.')
      // Si no se deshizo, lo borrado sigue borrado: vence como si se hubiera acabado el tiempo.
      o.alVencer?.()
    }
  }, [ocupado, onDeshecho])

  const aviso = oferta ? (
    <div
      role="status"
      aria-live="polite"
      data-aviso-deshacer
      className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-xl items-center gap-3 overflow-hidden rounded-xl bg-[#191713] px-4 py-3 text-sm text-[#F3F1EC] shadow-[0_10px_30px_rgba(0,0,0,.25)] lg:bottom-6"
    >
      <span className="min-w-0 flex-1">{oferta.mensaje}</span>
      <button
        type="button"
        onClick={pulsar}
        disabled={ocupado}
        className="shrink-0 rounded-md border border-[#6FB89D] bg-transparent px-2.5 py-1 text-[13px] font-semibold text-[#6FB89D] disabled:opacity-50"
      >
        Deshacer ({quedan})
      </button>
      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-[3px] bg-[#6FB89D] transition-[width] duration-1000 ease-linear"
        style={{ width: `${(quedan / SEGUNDOS_DESHACER) * 100}%` }}
      />
    </div>
  ) : null

  return { ofrecer, aviso }
}
