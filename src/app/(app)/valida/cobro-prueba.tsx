'use client'

import { useState, useTransition } from 'react'
import { CreditCard } from 'lucide-react'
import { cancelarPruebaValida } from './cancelar-prueba-acciones'

/**
 * El cobro al cumplirse los 7 días de la prueba, en la cuenta (Condiciones v2.0): la fecha y la hora
 * del cobro (7.1) y el botón «Cancelar prueba» (7.3), con ese nombre exacto.
 *
 * Es el lugar para el retiro del plan (Términos 12.3, pendiente): el mismo bloque, con «Retirarme del
 * plan» cuando la cuenta ya pagó. No se construyó aquí porque el retiro tiene que apagar la renovación
 * y anular la cuota ya creada del mes siguiente, y eso es lógica del plan de cobro, no de la prueba.
 */

const PESOS = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

export function CobroPrueba({
  estado,
  fechaYHora,
  precio,
  boton,
  puedeCancelar,
}: {
  estado: string
  /** «martes, 20 de octubre de 2026, 3:00 p. m.», ya en hora de Colombia. */
  fechaYHora: string
  precio: number
  /** «Cancelar prueba»: el nombre que prometen las Condiciones. */
  boton: string
  /** Solo la persona dueña, y mientras no haya empezado el cobro. */
  puedeCancelar: boolean
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  const [pendiente, iniciar] = useTransition()

  if (estado === 'cancelado' || mensaje?.ok) {
    return (
      <section data-cobro-prueba="cancelado" className="rounded-lg border border-border bg-white p-4 text-sm text-tinta">
        {mensaje?.texto ?? 'Cancelaste la prueba: no se cobrará nada. Las consultas que te quedan siguen disponibles.'}
      </section>
    )
  }
  if (estado !== 'programado') return null

  function cancelar() {
    iniciar(async () => {
      const r = await cancelarPruebaValida()
      setMensaje(r)
      setConfirmando(false)
    })
  }

  return (
    <section data-cobro-prueba="programado" className="rounded-lg border border-border bg-white p-4 text-sm text-tinta">
      <div className="flex items-start gap-3">
        <CreditCard className="mt-0.5 hidden h-5 w-5 shrink-0 text-acento sm:block" />
        <div className="w-full space-y-3">
          <p>
            Tu prueba gratis termina el <strong>{fechaYHora}</strong> (hora de Colombia). Si no la cancelas antes, después de ese
            momento se cobran ${PESOS.format(precio)} por el primer mes a la tarjeta que registraste, y luego cada mes.
          </p>
          {mensaje && !mensaje.ok && <p className="text-red-600">{mensaje.texto}</p>}
          {puedeCancelar && !confirmando && (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border px-5 font-semibold text-tinta sm:w-auto"
            >
              {boton}
            </button>
          )}
          {puedeCancelar && confirmando && (
            <div className="space-y-2">
              <p>No se cobrará nada y le pediremos a ePayco borrar tu tarjeta. Las consultas que te quedan siguen disponibles.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={cancelar}
                  disabled={pendiente}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-acento px-5 font-semibold text-white disabled:opacity-60"
                >
                  {pendiente ? 'Cancelando...' : 'Sí, cancelar la prueba'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  disabled={pendiente}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-5 font-semibold text-tinta"
                >
                  No
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
