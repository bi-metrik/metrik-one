'use client'

/**
 * «Emitir pendientes» (adenda Siigo): los recibos de caja de viajes que quedaron pendientes
 * mientras Siigo no estaba conectado. Encender Siigo no los emite solo: aquí se emiten en lote,
 * con el conteo a la vista y una confirmación. Si el conteo cambió, el servidor no emite y pide
 * confirmar de nuevo.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { useIntencion } from '@/hooks/use-intencion'
import { emitirPendientesSiigoViaje } from '../negocios/facturacion-viaje-actions'

const BOTON = 'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium disabled:opacity-50'

export default function PendientesSiigoViaje({ recibos, entorno }: { recibos: number; entorno: 'pruebas' | 'produccion' | null }) {
  const router = useRouter()
  const [conteo, setConteo] = useState(recibos)
  const [confirmando, setConfirmando] = useState(false)
  const [isPending, startTransition] = useTransitionTolerante()
  const intencion = useIntencion()
  if (conteo === 0) return null

  const donde = entorno === 'pruebas' ? 'la empresa de pruebas de Siigo' : entorno === 'produccion' ? 'los libros reales de Siigo' : 'Siigo'

  function emitir() {
    startTransition(async () => {
      const r = await emitirPendientesSiigoViaje(conteo, intencion.clave())
      intencion.cerrar()
      if (!r.ok) {
        if (typeof r.conteo === 'number') setConteo(r.conteo)
        toast.error(r.error)
        return
      }
      toast.success(r.siguenPendientes > 0
        ? `Se emitieron ${r.emitidos}. ${r.siguenPendientes} siguen pendientes: revisa su motivo en cada viaje.`
        : `Se emitieron ${r.emitidos} recibos.`)
      setConfirmando(false)
      router.refresh()
    })
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
      <p className="text-amber-900">
        {conteo === 1 ? 'Hay 1 recibo de caja de viajes pendiente.' : `Hay ${conteo} recibos de caja de viajes pendientes.`}
      </p>
      {confirmando ? (
        <div className="mt-2 space-y-2">
          <p className="text-amber-900">Se van a emitir {conteo} recibos en {donde}. Cada uno consume numeración y no se deshace. ¿Seguir?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={emitir} disabled={isPending} className={`${BOTON} bg-[#10B981] text-white`}>
              {isPending ? 'Emitiendo…' : `Sí, emitir ${conteo}`}
            </button>
            <button type="button" onClick={() => setConfirmando(false)} disabled={isPending} className={`${BOTON} border bg-white`}>Volver</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmando(true)} className={`${BOTON} mt-2 border border-amber-300 bg-white`}>
          Emitir pendientes
        </button>
      )}
    </div>
  )
}
