'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cancelarReservaAction, confirmarPagoManualAction } from './actions'

/** Confirmar un pago verificado a mano y cancelar: los botones de la lista del día y del detalle de la función. */
export function AccionesReserva(p: { funcionId: string; reservaId: string; estado: string; nombre: string | null }) {
  const [pendiente, empezar] = useTransition()
  const router = useRouter()

  const correr = (f: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    empezar(async () => {
      const r = await f()
      if (r.ok) {
        toast.success(ok)
        router.refresh()
      } else toast.error(r.error ?? 'No se pudo.')
    })

  return (
    <span className="inline-flex gap-1 print:hidden">
      {p.estado === 'apartada' && (
        <button
          type="button"
          disabled={pendiente}
          onClick={() => {
            if (confirm(`¿El pago de ${p.nombre ?? 'esta reserva'} ya está verificado (transferencia revisada)?`)) {
              correr(() => confirmarPagoManualAction(p.funcionId, p.reservaId), 'Pago verificado: reserva confirmada.')
            }
          }}
          className="rounded border border-[#10B981] px-2 py-0.5 text-xs text-[#059669] hover:bg-emerald-50 disabled:opacity-50"
        >
          Pago verificado
        </button>
      )}
      <button
        type="button"
        disabled={pendiente}
        onClick={() => {
          if (confirm(`¿Cancelar la reserva de ${p.nombre ?? 'esta persona'}? Libera su cupo.`)) {
            correr(() => cancelarReservaAction(p.funcionId, p.reservaId), 'Reserva cancelada.')
          }
        }}
        className="rounded border border-[#E5E7EB] px-2 py-0.5 text-xs text-[#6B7280] hover:bg-gray-50 disabled:opacity-50"
      >
        Cancelar
      </button>
    </span>
  )
}
