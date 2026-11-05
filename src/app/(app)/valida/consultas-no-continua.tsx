'use client'

import { useState, useTransition } from 'react'
import { BOTON_PAGAR_PERIODO } from '@/lib/valida-cda/venta-16-4'
import { pagarPeriodoReactivacionCda } from './reactivar-acciones'

/**
 * En el historial, en lugar de la consulta individual y la masiva, cuando el CDA aceptó la v1.5 después de
 * la base de la 16.4 y ningún período vendido cubre hoy (`noContinuaCda`): vuelve a empezar pagando un
 * período desde el día del pago. El botón, solo la persona designada en su sesión (la acción lo vuelve a
 * exigir); el historial y los reportes siguen abiertos.
 */
export function ConsultasNoContinua({ mensaje, puedePagar }: { mensaje: string; puedePagar: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  return (
    <section data-consultas-no-continua className="rounded-lg border border-border bg-white p-4 text-sm text-tinta sm:p-5">
      <p className="font-semibold">{mensaje}</p>
      <p className="mt-1 text-tinta-suave">En la pestaña Historial puedes ver y descargar los reportes ya generados.</p>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {puedePagar && (
        <button
          type="button"
          data-pagar-periodo-16-4
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              setError(null)
              const r = await pagarPeriodoReactivacionCda()
              if (r.ok) window.location.assign(r.url)
              else setError(r.error)
            })
          }
          className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-acento px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pendiente ? 'Preparando el pago…' : BOTON_PAGAR_PERIODO}
        </button>
      )}
    </section>
  )
}
