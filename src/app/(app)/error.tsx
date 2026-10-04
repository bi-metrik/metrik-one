'use client'

import AnimacionMarca from '@/components/marca/animacion-marca'
import { useRecuperacionDeRed } from '@/hooks/use-recuperacion-de-red'
import { olvidarRecargas, sessionStorageSeguro } from '@/lib/red/auto-recarga'
import { TEXTO_SIN_INTERNET, textoPantallaDeError } from '@/lib/red/error-de-red'
import { RefreshCw } from 'lucide-react'

/**
 * Red de seguridad de la app. Sin este archivo, cualquier excepcion de cliente
 * dejaba la pantalla en blanco con "Application error: a client-side exception
 * has occurred" y sin una sola pista — que fue exactamente lo que reporto
 * Jessica el 2026-08-18 y lo que nos costo el diagnostico.
 *
 * Un error de la APP muestra su `digest` (con el se encuentra la traza en los logs del
 * servidor) y un boton que RECARGA: la causa mas comun es una pestaña vieja pidiendo chunks
 * de un deployment retirado, y `reset()` reintentaria con el mismo bundle roto.
 *
 * Un error de RED o de chunk (`esErrorDeRed`) se recupera solo y, mientras tanto, se ve la
 * misma animacion de carga que `loading.tsx`, sin hablar de "conexión": el 2026-10-03 se
 * midio que la persona SI tenia internet (la ruta de su ISP hacia Vercel perdia paquetes).
 * La escalera (reintento suave, recargas con espera creciente, tope por ruta) vive en
 * `lib/red/auto-recarga.ts`; el texto solo cambia si el navegador dice que no hay red o
 * cuando se agotan los intentos.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const estado = useRecuperacionDeRed(error, reset, 'app')

  if (estado === 'recuperando' || estado === 'sin-internet') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6">
        <AnimacionMarca variante="liviana" tamano="clamp(1.6rem, 4vw, 2.2rem)" />
        {estado === 'sin-internet' && (
          <p className="text-sm text-muted-foreground">{TEXTO_SIN_INTERNET}</p>
        )}
      </div>
    )
  }

  const texto = textoPantallaDeError(error, 'Algo se rompió en esta pantalla')
  const recargar = () => {
    // Un clic de la persona no es un bucle: la carga siguiente vuelve a tener la escalera.
    olvidarRecargas(window.location.pathname, sessionStorageSeguro())
    window.location.reload()
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-lg font-semibold text-foreground">{texto.titulo}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{texto.cuerpo}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={recargar}
          className="inline-flex items-center gap-2 rounded-md bg-acento px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-acento"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Recargar
        </button>
        {estado === 'error' && (
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Reintentar
          </button>
        )}
      </div>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          Código de error: {error.digest}
        </p>
      )}
    </div>
  )
}
