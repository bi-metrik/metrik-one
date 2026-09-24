'use client'

import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { RegistrarVentaForm } from './registrar-venta-form'

/**
 * "Registrar venta" desde el botón flotante. Portal a `body`: montado dentro del header, un
 * `fixed inset-0` queda atrapado por el `backdrop-blur` (ya pasó tres veces en este producto).
 */
export default function RegistrarVentaModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-background p-4 shadow-xl sm:max-w-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Registrar venta de Ferretería</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <RegistrarVentaForm hoy={todayBogotaISO()} onRegistrada={onClose} />
      </div>
    </div>,
    document.body,
  )
}
