'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useIntencion } from '@/hooks/use-intencion'
import TarjetaEpayco, { type TarjetaEpaycoHandle } from '@/app/(marketing)/valida/empezar/tarjeta-epayco'
import { registrarTarjetaPagoAutomatico } from '../acciones'

/**
 * El formulario del pago automático de un CDA: la tarjeta en el recuadro de ePayco (los datos de la tarjeta
 * van a ePayco, nunca a ONE), la casilla de la autorización de la 2.4 (sin marcar) y «Guardar tarjeta». El
 * servidor vuelve a armar el texto de la casilla y lo compara antes de guardar nada.
 */
export function FormularioTarjetaCda({
  llavePublica,
  correo,
  autorizacion,
  cambiar,
}: {
  llavePublica: string
  correo: string
  /** El texto exacto de la casilla, con el día de renovación del CDA. */
  autorizacion: string
  /** Ya hay una tarjeta: esta la reemplaza. */
  cambiar: boolean
}) {
  const ref = useRef<TarjetaEpaycoHandle>(null)
  const [acepta, setAcepta] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  const intencion = useIntencion()
  const router = useRouter()

  function guardar() {
    if (!acepta) return
    setError(null)
    iniciar(async () => {
      let tarjeta
      try {
        tarjeta = await ref.current?.tokenizar()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No pudimos leer la tarjeta. Revisa los datos.')
        return
      }
      if (!tarjeta) return
      const r = await registrarTarjetaPagoAutomatico({ tarjeta, autorizacionMostrada: autorizacion, acepta }, intencion.clave())
      intencion.cerrar()
      if (!r.ok) {
        setError(r.error)
        return
      }
      toast.success(r.ultimos4 ? `Pago automático activo con la tarjeta terminada en ${r.ultimos4}.` : 'Pago automático activo.')
      router.push('/suscripcion?tab=pagos')
    })
  }

  return (
    <div data-formulario-tarjeta-cda className="space-y-4">
      <TarjetaEpayco ref={ref} llavePublica={llavePublica} correo={correo} leyenda={cambiar ? 'Tarjeta nueva' : 'Tarjeta para el pago automático'} />
      <label className="flex items-start gap-2 text-sm text-tinta">
        <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="mt-1" data-casilla-autorizacion />
        <span>{autorizacion}</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-guardar-tarjeta
          disabled={!acepta || pendiente}
          onClick={guardar}
          className="inline-flex h-11 items-center justify-center rounded-md bg-acento px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pendiente ? 'Guardando…' : cambiar ? 'Guardar la tarjeta nueva' : 'Guardar tarjeta'}
        </button>
        <Link href="/suscripcion?tab=pagos" className="inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold text-tinta-suave">
          Volver
        </Link>
      </div>
    </div>
  )
}
