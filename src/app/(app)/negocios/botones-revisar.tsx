'use client'

import { FileDown, Send } from 'lucide-react'

/**
 * Los dos botones del paso «Revisar y enviar» de la cotización de viaje (P13 del caso
 * Providencia, 2026-09-23).
 *
 * «Descargar PDF» a la izquierda y «Enviar», la acción principal, al final y a la derecha. En
 * el celular «Enviar» va arriba y a todo el ancho, «Descargar» debajo. `flex-col-reverse`
 * invierte solo la pila visual: en el DOM (y para el teclado) Descargar sigue antes que Enviar,
 * que es el mismo orden que se lee en el escritorio.
 */
export default function BotonesRevisar({
  editable,
  pendiente,
  motivoParaNoEnviar,
  describedBy,
  onDescargar,
  onEnviar,
}: {
  editable: boolean
  pendiente: boolean
  /** Por qué Enviar está apagado. `null` = se puede enviar. */
  motivoParaNoEnviar: string | null
  describedBy?: string
  onDescargar: () => void
  onEnviar: () => void
}) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between" data-botones-revisar>
      <button
        type="button"
        onClick={onDescargar}
        disabled={pendiente}
        data-boton="descargar"
        className="inline-flex w-full items-center justify-center gap-1 rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50 sm:w-auto"
      >
        <FileDown className="h-3 w-3" />
        Descargar PDF
      </button>
      {editable && (
        <button
          type="button"
          onClick={onEnviar}
          disabled={pendiente || motivoParaNoEnviar !== null}
          title={motivoParaNoEnviar ?? undefined}
          aria-describedby={describedBy}
          data-boton="enviar"
          className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <Send className="h-3 w-3" />
          Enviar
        </button>
      )}
    </div>
  )
}
