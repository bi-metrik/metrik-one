'use client'

import { createPortal } from 'react-dom'

/**
 * «¿Ya se la mandaste?» (H33, boceto D de Noor). Sale tras descargar el PDF de una cotización en
 * borrador. «Sí» la marca enviada (estado, fecha de envío y seguimiento); «No» no marca nada.
 * Sin «no volver a preguntar»: es un toque y protege el embudo.
 *
 * Portal al body, como `ElegirOrigenVersion`: los botones viven dentro de barras con
 * `backdrop-blur`, que atrapan un `fixed`.
 */
export default function PreguntaEnvio({
  pendiente,
  onSi,
  onNo,
}: {
  pendiente: boolean
  onSi: () => void
  onNo: () => void
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-pregunta-envio"
      aria-describedby="detalle-pregunta-envio"
      data-pregunta-envio
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-4 shadow-xl">
        <h2 id="titulo-pregunta-envio" className="text-sm font-semibold">¿Ya se la mandaste al cliente?</h2>
        <p id="detalle-pregunta-envio" className="mt-1 text-xs text-muted-foreground">
          Si dices que sí, queda enviada, ya no se edita y empieza el seguimiento.
        </p>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-respuesta="no"
            disabled={pendiente}
            onClick={onNo}
            className="min-h-[44px] rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50"
          >
            No, solo la estoy revisando
          </button>
          <button
            type="button"
            data-respuesta="si"
            disabled={pendiente}
            onClick={onSi}
            className="min-h-[44px] rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Sí, ya se la mandé
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
