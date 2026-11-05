'use client'

import { useState, useTransition } from 'react'
import { textosBloqueReactivar } from '@/lib/valida-cda/cancelada'
import { textosBloquePagarPeriodo } from '@/lib/valida-cda/venta-16-4'
import { pagarPeriodoReactivacionCda } from '../valida/reactivar-acciones'

/**
 * «Reactivar la suscripción» en `/suscripcion` con la suscripción Cancelada (Términos v1.5, 11.4): un
 * período, que corre desde el día del pago. Solo la persona designada en su sesión (la acción lo vuelve a
 * exigir); en «Ver como», sin botón. Lo de antes del 1-dic que siga sin pagar se dice que no condiciona.
 */
export function ReactivarSuscripcion({
  monto,
  hayCartera,
  soloLectura,
  variante = 'cancelada',
}: {
  monto: number | null
  hayCartera: boolean
  soloLectura: boolean
  /** `v15_tarde`: aceptó la v1.5 después de la base de la 16.4 y vuelve a empezar (mismo flujo, otro texto). */
  variante?: 'cancelada' | 'v15_tarde'
}) {
  const t = variante === 'v15_tarde' ? textosBloquePagarPeriodo({ monto }) : textosBloqueReactivar({ monto, hayCartera })
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  return (
    <section data-reactivar-suscripcion className="rounded-lg border border-border bg-white p-4 text-sm text-tinta sm:p-5">
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
