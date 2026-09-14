'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import type { ConfirmacionAvance } from '@/lib/negocios/confirmacion-avance'

/**
 * Confirmación antes de entregarle el caso a otra área.
 *
 * El texto NO lo decide esta pantalla: llega del servidor, que lo arma desde la
 * configuración de la etapa destino ya resuelta (`confirmar_al_avanzar`) y le mete el
 * saldo real. Escribirlo aquí obligaría a mantener dos textos y a que el cliente
 * adivinara a qué etapa va a aterrizar el caso.
 *
 * Vive en `components/` y no dentro de la ficha porque lo usan DOS superficies: el botón
 * "Avanzar de etapa" de la ficha y el panel que aparece tras registrar un pago. Y no es
 * un caso raro: en SOENA la etapa "Segundo cobro" no tiene routing, así que su destino
 * por defecto es "Cartera", que SÍ pide confirmación. Duplicar el diálogo dejaría a una
 * de las dos superficies preguntando distinto sobre la misma entrega.
 */
export default function ModalConfirmarAvance({
  confirmacion,
  onClose,
  onConfirmar,
  pendiente,
}: {
  confirmacion: ConfirmacionAvance
  onClose: () => void
  onConfirmar: () => void
  pendiente: boolean
}) {
  // Mismo tratamiento que el modal de gate: scroll bloqueado y Escape para cerrar.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  // Portal a document.body por el header sticky con `backdrop-blur`, que atrapa
  // cualquier `fixed inset-0` montado dentro (ya documentado en el repo). Desde el modal
  // de pago hace falta por otra razón: ese modal también es un `fixed`, y sin el portal
  // la confirmación quedaría por debajo de él.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto overscroll-contain select-none bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="my-auto flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-[#E5E7EB] p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <h3 className="flex-1 text-sm font-semibold text-tinta">{confirmacion.titulo}</h3>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {confirmacion.parrafos.map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-tinta">{p}</p>
          ))}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[#E5E7EB] p-4">
          <button
            onClick={onClose}
            disabled={pendiente}
            className="rounded-md px-3 py-1.5 text-[13px] font-medium text-tinta-suave hover:text-tinta disabled:opacity-50"
          >
            {confirmacion.cancelar}
          </button>
          <button
            onClick={onConfirmar}
            disabled={pendiente}
            className="rounded-md px-3 py-1.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
            style={{ backgroundColor: 'var(--acento)' }}
          >
            {pendiente ? 'Pasando…' : confirmacion.confirmar}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
