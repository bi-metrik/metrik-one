import type { TransitionFunction } from 'react'
import { esErrorDeRed } from './error-de-red'

type Callback = TransitionFunction

/**
 * Envuelve el callback de una transicion para que una falla de RED no tumbe la pantalla.
 *
 * Con React 19 lo que lanza un `startTransition(async () => …)` sube al error boundary
 * mas cercano: un server action que no llega (iPhone sin señal → `TypeError: Load
 * failed`) reemplazaba la ficha entera por "Algo se rompió en esta pantalla". Ahora ese
 * caso llama a `avisar` (un toast) y la transicion termina en silencio.
 *
 * Cualquier otro error se relanza igual que antes: un bug sigue llegando al boundary y a
 * los logs. Las respuestas `{ error }` de las acciones no pasan por aqui (no lanzan).
 *
 * No reintenta: no se sabe si la escritura alcanzo al servidor (ver `conReintentoDeRed`).
 */
export function envolverTolerante(cb: Callback, avisar: (error: unknown) => void): Callback {
  return () => {
    const manejar = (e: unknown) => {
      if (esErrorDeRed(e)) {
        avisar(e)
        return
      }
      throw e
    }
    let resultado: ReturnType<Callback>
    try {
      resultado = cb()
    } catch (e) {
      return manejar(e)
    }
    if (resultado instanceof Promise) return resultado.catch(manejar)
    return resultado
  }
}
