'use client'

import { useState, useTransition } from 'react'
import { cancelarPruebaValida } from './cancelar-prueba-acciones'

/**
 * Las dos piezas del cobro al cumplirse los 7 días de la prueba (Condiciones v2.0, 7.1 y 7.3), para la
 * franja de `/valida` y la Suscripción en prueba de `/suscripcion`:
 *
 *   - `ClausulaCobro`: el texto de la fecha y la hora del cobro, el valor y la recurrencia. Es el texto
 *     EXACTO de siempre (no se cambia una palabra sin Emilio). En el celular se ve un resumen con la
 *     fecha y el valor, y el texto completo se despliega con un toque; el texto completo está SIEMPRE en
 *     el HTML (solo lo esconde el CSS), nunca se quita.
 *   - `CancelarPrueba`: el botón «Cancelar prueba», con ese nombre exacto (7.3), y su confirmación. Es
 *     la misma acción en las dos pantallas (`cancelarPruebaValida`).
 *
 * Es el lugar para el retiro del plan (Términos 12.3, pendiente): con «Retirarme del plan» cuando la
 * cuenta ya pagó. No se construyó aquí porque el retiro tiene que apagar la renovación y anular la cuota
 * ya creada del mes siguiente, y eso es lógica del plan de cobro, no de la prueba.
 */

const PESOS = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

/** El texto de la cláusula, palabra por palabra, como lo lee la persona (las pruebas lo comparan). */
export function textoClausulaCobro(fechaYHora: string, precio: number): string {
  return `Tu prueba gratis termina el ${fechaYHora} (hora de Colombia). Si no la cancelas antes, después de ese momento se cobran $${PESOS.format(precio)} por el primer mes a la tarjeta que registraste, y luego cada mes.`
}

export const TEXTO_PRUEBA_CANCELADA = 'Cancelaste la prueba: no se cobrará nada. Las consultas que te quedan siguen disponibles.'

export function ClausulaCobro({
  fechaYHora,
  fechaCorta,
  precio,
}: {
  /** «martes, 20 de octubre de 2026, 3:00 p. m.», ya en hora de Colombia. */
  fechaYHora: string
  /** «20 de oct, 3:00 p. m.»: la misma fecha, para el resumen del celular. */
  fechaCorta: string
  precio: number
}) {
  const [abierta, setAbierta] = useState(false)
  return (
    <div data-clausula-cobro className="text-xs text-tinta-suave">
      {/* Celular: fecha y valor siempre a la vista; el texto completo, con un toque. */}
      <p className="flex flex-wrap items-baseline gap-x-2 sm:hidden" data-resumen-cobro>
        <span>
          Primer cobro: <strong className="font-semibold text-tinta">${PESOS.format(precio)}</strong> el{' '}
          <strong className="font-semibold text-tinta">{fechaCorta}</strong>
        </span>
        <button
          type="button"
          onClick={() => setAbierta((a) => !a)}
          aria-expanded={abierta}
          aria-controls="clausula-cobro-texto"
          className="font-semibold text-acento underline-offset-2 hover:underline"
        >
          {abierta ? 'Ocultar condiciones' : 'Ver condiciones'}
        </button>
      </p>
      <p id="clausula-cobro-texto" data-texto-clausula className={`${abierta ? 'mt-1 block' : 'hidden'} sm:block`}>
        Tu prueba gratis termina el <strong className="font-semibold text-tinta">{fechaYHora}</strong> (hora de Colombia). Si no la
        cancelas antes, después de ese momento se cobran ${PESOS.format(precio)} por el primer mes a la tarjeta que registraste, y
        luego cada mes.
      </p>
    </div>
  )
}

export function CancelarPrueba({
  boton,
  onCancelada,
  className = '',
}: {
  /** «Cancelar prueba»: el nombre que prometen las Condiciones. */
  boton: string
  onCancelada?: (texto: string) => void
  className?: string
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()

  function cancelar() {
    iniciar(async () => {
      const r = await cancelarPruebaValida()
      setConfirmando(false)
      if (r.ok) onCancelada?.(r.texto)
      else setError(r.texto)
    })
  }

  if (!confirmando) {
    return (
      <span className={className}>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setConfirmando(true)
          }}
          className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-tinta-suave hover:text-tinta"
        >
          {boton}
        </button>
        {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
      </span>
    )
  }
  return (
    <div data-confirmar-cancelacion className={`w-full space-y-2 text-sm text-tinta ${className}`}>
      <p>No se cobrará nada y le pediremos a ePayco borrar tu tarjeta. Las consultas que te quedan siguen disponibles.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={cancelar}
          disabled={pendiente}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-acento px-4 font-semibold text-white disabled:opacity-60"
        >
          {pendiente ? 'Cancelando...' : 'Sí, cancelar la prueba'}
        </button>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          disabled={pendiente}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 font-semibold text-tinta"
        >
          No
        </button>
      </div>
    </div>
  )
}
