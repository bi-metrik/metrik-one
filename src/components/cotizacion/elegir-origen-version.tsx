'use client'

import { createPortal } from 'react-dom'
import { ORIGENES_VERSION, type OrigenVersion } from '@/lib/negocios/seguimiento'

/**
 * «¿De dónde sale la versión nueva?» (F1-3, seguimiento). Se pregunta UNA vez al duplicar una
 * cotización en una línea con el seguimiento encendido; con eso el embudo cuenta versiones y
 * su origen sin que nadie teclee nada más. La prerreserva vencida no se ofrece: la escribe el
 * sistema (Vera C9).
 *
 * Portal al body: el botón vive dentro de barras con `backdrop-blur`, que atrapan un `fixed`.
 */
export default function ElegirOrigenVersion({
  pendiente,
  onElegir,
  onCancelar,
}: {
  pendiente: boolean
  onElegir: (origen: OrigenVersion) => void
  onCancelar: () => void
}) {
  if (typeof document === 'undefined') return null
  const opciones = ORIGENES_VERSION.filter((o) => o.value !== 'prerreserva_vencida')
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-origen-version"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-4 shadow-xl">
        <h2 id="titulo-origen-version" className="text-sm font-semibold">¿De dónde sale la versión nueva?</h2>
        <div className="mt-3 space-y-2" data-origenes-version>
          {opciones.map((o) => (
            <button
              key={o.value}
              type="button"
              data-origen={o.value}
              disabled={pendiente}
              onClick={() => onElegir(o.value)}
              className="flex min-h-[44px] w-full items-center rounded-lg border border-border px-3 text-left text-sm hover:bg-accent disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancelar}
          className="mt-3 min-h-[44px] w-full rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-accent"
        >
          Cancelar
        </button>
      </div>
    </div>,
    document.body,
  )
}
