'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { escribirPrecioQueFalta, usarTotalDeHabitacion } from '@/app/(app)/negocios/tarifa-pax-actions'
import { listaDeTipos } from '@/lib/cotizaciones/precio-que-falta'
import type { TipoPasajero } from '@/lib/cotizaciones/tarifa-pasajero'
import { parseMontoCop } from '@/lib/negocios/monto-cop'

/**
 * EL PRECIO POR PASAJERO QUE FALTA, en la tarjeta de la opción (regla del 2026-10-12, P12; H3 de
 * la verificación D). La regla dice que se cierra de tres maneras: un pantallazo nuevo
 * («Completa …» en la bandeja), «Escribir a mano» o «No paga en este proveedor». Las dos últimas
 * tenían acción en el servidor (`escribirPrecioQueFalta`) pero ningún botón en la pantalla: una
 * actividad con precio de grupo («8 pasajeros · Total») quedaba «sin costo» sin salida.
 *
 * El costo es c/u y en la moneda de la tarifa, como lo pide la acción.
 */
export function PrecioQueFaltaPorPasos({
  itemId,
  nombre,
  tipos,
  moneda,
  esHotel = false,
  onGuardado,
}: {
  itemId: string
  nombre: string
  tipos: readonly TipoPasajero[]
  moneda: string
  /** M7-1 / M9-2 · un hotel puede decir que el total es el de la habitación. */
  esHotel?: boolean
  onGuardado: () => void
}) {
  const [valores, setValores] = useState<Partial<Record<TipoPasajero, string>>>({})
  const [guardando, setGuardando] = useState<TipoPasajero | null>(null)
  if (tipos.length === 0) return null

  const guardar = async (tipo: TipoPasajero, unitario: number) => {
    setGuardando(tipo)
    try {
      const r = await escribirPrecioQueFalta(itemId, tipo, unitario)
      if (!r.success) {
        toast.error(r.error ?? 'No se pudo guardar el precio.')
        return
      }
      if (r.error) toast.warning(r.error)
      setValores(v => ({ ...v, [tipo]: '' }))
      onGuardado()
    } catch {
      toast.error('No se pudo guardar: revisa la conexión y vuelve a intentarlo.')
    } finally {
      setGuardando(null)
    }
  }

  const totalDeHabitacion = async () => {
    setGuardando(tipos[0])
    try {
      const r = await usarTotalDeHabitacion(itemId, true)
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar.'); return }
      onGuardado()
    } catch {
      toast.error('No se pudo guardar: revisa la conexión y vuelve a intentarlo.')
    } finally {
      setGuardando(null)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-[#F1C7C1] bg-[#FBEDEB] px-3 py-2" data-precio-que-falta={itemId}>
      <p className="m-0 text-[13px] text-[#B3382C]">
        {nombre} no trae el precio del {listaDeTipos(tipos)}. Hasta tenerlo, no se puede enviar.
      </p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {tipos.map(tipo => {
          const texto = valores[tipo] ?? ''
          const monto = parseMontoCop(texto)
          const ocupado = guardando !== null
          return (
            <div key={tipo} className="flex flex-wrap items-center gap-2 text-[13px]" data-precio-tipo={tipo}>
              <label className="flex items-center gap-1.5">
                <span className="text-[#191713]">Costo c/u del {listaDeTipos([tipo])}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="w-28 rounded-md border border-[#CFCAC0] bg-white px-2 py-0.5 text-right"
                  placeholder={moneda}
                  value={texto}
                  disabled={ocupado}
                  onChange={e => setValores(v => ({ ...v, [tipo]: e.target.value }))}
                />
              </label>
              <button
                type="button"
                className="rounded-md border border-[#0E5C43] bg-[#0E5C43] px-2 py-0.5 font-semibold text-white disabled:opacity-50"
                disabled={ocupado || monto === null || monto <= 0}
                onClick={() => monto !== null && void guardar(tipo, monto)}
              >
                Guardar
              </button>
              <button
                type="button"
                className="rounded-md border border-[#CFCAC0] bg-white px-2 py-0.5 text-[#191713] disabled:opacity-50"
                disabled={ocupado}
                onClick={() => void guardar(tipo, 0)}
              >
                No paga en este proveedor
              </button>
            </div>
          )
        })}
        {esHotel && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]" data-total-de-habitacion>
            <span className="text-[#191713]">¿Es una sola habitación para todo el grupo, con precio por habitación?</span>
            <button
              type="button"
              className="rounded-md border border-[#CFCAC0] bg-white px-2 py-0.5 text-[#191713] disabled:opacity-50"
              disabled={guardando !== null}
              onClick={() => void totalDeHabitacion()}
            >
              El total es de la habitación
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
