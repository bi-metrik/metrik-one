'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft } from 'lucide-react'
import DistribuirPagoModal from '@/components/distribuir-pago-modal'

/**
 * Acceso desde el detalle del negocio a "Distribuir pago entre negocios" — el
 * comercial propone el reparto de un pago entre varios negocios (misma mecánica que
 * el FAB global). Opt-in por workspace (flag modules.conciliacion). El guard real de
 * permisos vive en el server action (repartirPagoComercial).
 */
export default function DistribuirPagoButton() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 shrink-0" style={{ color: '#10B981' }} />
            <div>
              <p className="text-sm font-semibold text-foreground">Distribuir un pago entre negocios</p>
              <p className="text-[12px] text-muted-foreground">
                Un solo pago cubre varios negocios. Propón el reparto; el área financiera lo confirma.
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition hover:opacity-90"
            style={{ borderColor: '#10B981', color: '#10B981' }}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Distribuir pago
          </button>
        </div>
      </div>

      {open && (
        <DistribuirPagoModal
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); router.refresh() }}
        />
      )}
    </>
  )
}
