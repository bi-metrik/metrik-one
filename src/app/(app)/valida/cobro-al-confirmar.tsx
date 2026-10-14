'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { confirmarCobroAlConfirmar, ofertaDeCobroAlConfirmar, type OfertaEnPantalla } from './cobro-al-confirmar-acciones'

/**
 * «Activa tu plan ahora: se cobran $150.000 a tu tarjeta terminada en 0326» con UN botón (Condiciones
 * v2.1, 7.1 literal a). Nada se cobra sin ese clic. Si la cuenta no puede pagar así (sin tarjeta, otra
 * persona del espacio, un registro que aceptó la v2.0), muestra `children`: lo de siempre.
 *
 * `agotada`: la pantalla del corte (intentó la consulta 11). Sin ella, la de «Activar plan».
 * `oferta`: si el servidor ya la trae (la página de activar), no se vuelve a pedir.
 */
export function CobroAlConfirmar({ agotada, oferta: inicial, children }: { agotada: boolean; oferta?: OfertaEnPantalla; children: ReactNode }) {
  const [oferta, setOferta] = useState<OfertaEnPantalla | null>(inicial ?? null)
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null)
  const [pendiente, iniciar] = useTransition()

  useEffect(() => {
    if (inicial) return
    let vivo = true
    ofertaDeCobroAlConfirmar(agotada)
      .then((o) => vivo && setOferta(o))
      .catch(() => vivo && setOferta({ disponible: false }))
    return () => {
      vivo = false
    }
  }, [agotada, inicial])

  if (!oferta || !oferta.disponible) return <>{children}</>

  function confirmar() {
    iniciar(async () => {
      const r = await confirmarCobroAlConfirmar(agotada)
      setResultado(r)
      // El plan quedó activo: la página se recarga con el mes abierto y la consulta sigue.
      if (r.ok) setTimeout(() => window.location.assign('/valida'), 1500)
    })
  }

  return (
    <div data-cobro-al-confirmar={agotada ? 'agotada' : 'activar'} className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-tinta">{oferta.titulo}</h2>
        <p className="mt-1 text-sm text-tinta-suave">{oferta.detalle}</p>
      </div>
      {resultado ? (
        <p role="status" className={resultado.ok ? 'text-sm text-tinta' : 'text-sm text-red-600'}>
          {resultado.texto}
        </p>
      ) : (
        <button
          type="button"
          onClick={confirmar}
          disabled={pendiente}
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-acento px-5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
        >
          {pendiente ? 'Cobrando...' : oferta.boton}
        </button>
      )}
    </div>
  )
}
