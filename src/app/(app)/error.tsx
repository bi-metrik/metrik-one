'use client'

import { useEffect, useState } from 'react'
import { reportarErrorCliente } from '@/lib/errores-cliente/enviar'
import { intentarAutoRecarga } from '@/lib/red/auto-recarga'
import { RefreshCw } from 'lucide-react'

/**
 * Red de seguridad de la app. Sin este archivo, cualquier excepcion de cliente
 * dejaba la pantalla en blanco con "Application error: a client-side exception
 * has occurred" y sin una sola pista — que fue exactamente lo que reporto
 * Jessica el 2026-08-18 y lo que nos costo el diagnostico.
 *
 * Dos cosas que antes no habia: el `digest` visible (con el se encuentra la
 * traza real en los logs del servidor) y un boton que RECARGA, no que
 * reintenta. La causa mas comun de este error es una pestaña vieja pidiendo
 * chunks de un deployment ya retirado; `reset()` reintenta con el MISMO bundle
 * roto y vuelve a fallar. Por eso "Recargar" es la accion principal.
 *
 * Desde el 2026-10-02 recarga SOLA cuando lo que rompio fue la red o un chunk que no
 * bajo (iPhone con mala señal: `Load failed`, `Failed to load chunk`), una vez por ruta
 * cada 60 s (`intentarAutoRecarga`). Si la guarda ya se gasto, esta pantalla de siempre.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Se decide UNA vez, al montar: la guarda deja su marca en `sessionStorage` al decir
  // que si, asi que consultarla en cada render la gastaria. En el servidor no hay
  // `window` y da `false` (un error de servidor nunca es de red del telefono).
  const [recargar] = useState(() => intentarAutoRecarga(error))

  useEffect(() => {
    console.error('[app] error no capturado:', error)
    // Deja rastro en los logs de Vercel (`[error-cliente]`); nunca lanza ni espera. Va
    // por `sendBeacon`, que sobrevive a la recarga de abajo.
    reportarErrorCliente(error, 'app', recargar)
    if (recargar) window.location.reload()
  }, [error, recargar])

  if (recargar) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 px-6 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
        Se perdió la conexión. Recargando…
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        Algo se rompió en esta pantalla
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Casi siempre es una pestaña que llevaba mucho tiempo abierta. Recargar
        la deja al día y suele bastar.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-md bg-acento px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-acento"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Recargar
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Reintentar
        </button>
      </div>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          Código de error: {error.digest}
        </p>
      )}
    </div>
  )
}
