'use client'

import { useState, useTransition } from 'react'
import { textosBloqueReactivar } from '@/lib/valida-cda/cancelada'
import { pagarPeriodoReactivacionCda } from '../valida/reactivar-acciones'

/**
 * «Reactivar la suscripción» en `/suscripcion` con la suscripción Cancelada (Términos v1.5, 11.4): un
 * período, que corre desde el día del pago. Solo la persona designada en su sesión (la acción lo vuelve a
 * exigir); en «Ver como», sin botón. Lo de antes del 1-dic que siga sin pagar se dice que no condiciona.
 */
export function ReactivarSuscripcion({ monto, hayCartera, soloLectura }: { monto: number | null; hayCartera: boolean; soloLectura: boolean }) {
  const t = textosBloqueReactivar({ monto, hayCartera })
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  return (
    <section data-reactivar-suscripcion className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 sm:p-5">
      <p className="font-semibold">{t.titulo}</p>
      <p className="mt-1">{t.detalle}</p>
      {t.cartera && <p className="mt-1">{t.cartera}</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {!soloLectura && (
        <button
          type="button"
          data-reactivar-cda
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              setError(null)
              const r = await pagarPeriodoReactivacionCda()
              if (r.ok) window.location.assign(r.url)
              else setError(r.error)
            })
          }
          className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-acento px-4 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
        >
          {pendiente ? 'Preparando el pago…' : t.boton}
        </button>
      )}
    </section>
  )
}
