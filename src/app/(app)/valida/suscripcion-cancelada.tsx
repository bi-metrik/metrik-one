'use client'

import { useState, useTransition } from 'react'
import { Archive } from 'lucide-react'
import { textosPantallaCancelada } from '@/lib/valida-cda/cancelada'
import { pagarPeriodoReactivacionCda } from './reactivar-acciones'

/**
 * La pantalla de `/valida` con la suscripción Cancelada (Términos v1.5, 11.3), en lugar de todo el módulo:
 * el estado, que la información está guardada y cómo pedir la exportación (9.3), y cómo volver (11.4). La
 * ven TODOS los usuarios del CDA, sin montos; el botón para pagar el período, solo la persona designada
 * (`puedeReactivar`). Los textos salen de `cancelada.ts`.
 */
export function SuscripcionCancelada({ canceladaDesde, puedeReactivar }: { canceladaDesde: string; puedeReactivar: boolean }) {
  const t = textosPantallaCancelada({ canceladaDesde, puedeReactivar })
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  return (
    <section data-suscripcion-cancelada className="mx-auto max-w-2xl rounded-lg border border-border bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Archive className="mt-0.5 hidden h-5 w-5 shrink-0 text-tinta-suave sm:block" />
        <div className="space-y-3 text-sm text-tinta">
          <h1 className="text-base font-semibold">{t.titulo}</h1>
          <p>{t.estado}</p>
          <p>{t.informacion}</p>
          <p>{t.reactivar}</p>
          {error && <p className="text-xs text-red-700">{error}</p>}
          {t.boton && (
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
              className="inline-flex h-9 items-center justify-center rounded-lg bg-acento px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pendiente ? 'Preparando el pago…' : t.boton}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
