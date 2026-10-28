'use client'

import { useState, useTransition } from 'react'
import { Ban } from 'lucide-react'
import { pagarPeriodoReactivacion } from './reactivar-acciones'

/**
 * El plan de una cuenta autogestionada suspendido por la reversión del pago (decisión de Mauricio del
 * 2026-10-27, `corte-reverso-servidor.ts`). Arriba, para todos los usuarios del espacio; el botón para
 * pagar el período, solo para quien maneja el pago. Los textos salen de `frasesSuspension`, los mismos
 * del correo al cliente.
 *
 * ⚠️ PENDIENTE DE VERA, con el correo.
 */
export const TITULO_SUSPENSION_REVERSO = 'Tu plan de Valida está suspendido por la reversión del pago'
export const HISTORIAL_DISPONIBLE = 'Tus reportes y tu historial siguen disponibles en la pestaña Historial.'
export const COMO_REACTIVAR = 'Para reactivar el plan, paga el período.'
export const COMO_REACTIVAR_SIN_PAGO = 'Para reactivar el plan, la persona designada por tu empresa puede pagar el período desde esta pantalla.'

export function PlanSuspendidoPorReverso({
  frases,
  puedePagar,
}: {
  frases: { reversado: string; desde: string }
  puedePagar: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  return (
    <section
      data-plan-suspendido-reverso
      className="flex flex-col gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 sm:flex-row sm:items-start"
    >
      <div className="flex items-start gap-3">
        <Ban className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">{TITULO_SUSPENSION_REVERSO}</p>
          <p>
            {frases.reversado} {frases.desde}
          </p>
          <p>{HISTORIAL_DISPONIBLE}</p>
          <p>{puedePagar ? COMO_REACTIVAR : COMO_REACTIVAR_SIN_PAGO}</p>
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      </div>
      {puedePagar && (
        <button
          type="button"
          data-pagar-periodo
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              setError(null)
              const r = await pagarPeriodoReactivacion()
              if (r.ok) window.location.assign(r.url)
              else setError(r.error)
            })
          }
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-acento px-4 text-sm font-semibold text-white disabled:opacity-60 sm:ml-auto"
        >
          {pendiente ? 'Preparando el pago…' : 'Pagar el período'}
        </button>
      )}
    </section>
  )
}
