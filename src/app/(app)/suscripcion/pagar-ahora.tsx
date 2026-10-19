'use client'

import { useState, useTransition } from 'react'
import { pagarCuotaPendiente } from './acciones'

/**
 * «Pagar ahora»: pide el enlace de pago de la cuota pendiente y lo abre. Para una suscripción (Valida
 * autogestionada), cuando no hay enlace vigente; el cron lo mandaría solo al día hábil siguiente.
 */
export function PagarAhora() {
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  return (
    <div className="space-y-1">
      <button
        type="button"
        data-pagar-ahora
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            setError(null)
            const r = await pagarCuotaPendiente()
            if (r.ok) window.location.assign(r.url)
            else setError(r.error)
          })
        }
        className="inline-flex w-full items-center justify-center rounded-md bg-acento px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
      >
        {pendiente ? 'Preparando el pago…' : 'Pagar ahora'}
      </button>
      {error && <p className="max-w-xs text-xs text-red-600">{error}</p>}
    </div>
  )
}
