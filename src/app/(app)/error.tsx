'use client'

import { useEffect } from 'react'
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
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app] error no capturado:', error)
  }, [error])

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
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
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
