import type { TipoNavegacion } from './colector'

/**
 * Donde empieza una navegacion suave, para medir cuanto tarda hasta que pinta el destino.
 *
 * Lo marca quien la dispara: `navegar()` de `NavegacionPendienteProvider` (tarjetas), el
 * clic en un `<a>` interno y el boton atras (`rum-red.tsx`). Lo termina `rum-red.tsx`
 * cuando cambia la ruta. Modulo aparte y sin dependencias: el proveedor lo importa sin
 * arrastrar el resto de la medicion.
 */

type Suscriptor = (tipo: TipoNavegacion, ahora: number, href?: string) => void

let suscriptor: Suscriptor | null = null

/** `href`: el destino, para descartar las que no cambian de ruta (solo cambian la query). */
export function marcarInicioNavegacion(tipo: TipoNavegacion, href?: string): void {
  try {
    suscriptor?.(tipo, performance.now(), href)
  } catch {
    // La medicion nunca frena una navegacion.
  }
}

/** Lo registra `rum-red.tsx` al montar; devuelve con que soltarlo. */
export function escucharInicioNavegacion(fn: Suscriptor): () => void {
  suscriptor = fn
  return () => {
    if (suscriptor === fn) suscriptor = null
  }
}
