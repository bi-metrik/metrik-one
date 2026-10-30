/**
 * La forma que admite una foto de HOTEL (regla de fotos de la propuesta, Ren, 2026-10-29). Puro.
 *
 * Una ficha de hotel lleva una foto por casilla. Un collage (tres fotos pegadas del sitio oficial)
 * o una foto vertical se ven mal en cualquier casilla: el collage sale partido y la vertical
 * recortada a la mitad. Por eso ONE las frena al subirlas y el PDF no usa las que ya estaban.
 *
 * Límites, medidos sobre la biblioteca de Trappvel el 2026-10-29 (22 fotos de hotel):
 *  · las fotos sueltas van de 1,0 (cuadrada) a 2,0 (la panorámica más ancha), casi todas entre
 *    1,36 y 1,51 (3:2 y 4:3);
 *  · las dos que no sirven: un tríptico de 2,79 y una vertical de 0,67.
 * `PROPORCION_MAXIMA` = 2,1 deja pasar la panorámica de 2,0 y frena los trípticos (dos fotos
 * cuadradas pegadas dan 2,0 y no se distinguen de una panorámica por la forma; tres ya dan 2,25 o
 * más). `PROPORCION_MINIMA` = 0,75 frena las verticales de teléfono (9:16 = 0,56, 2:3 = 0,67) y
 * deja la de 4:5 (0,80) de la biblioteca: si no cabe en ninguna casilla sin recortarla de más, el
 * PDF tampoco la usa (`fotos-ficha.ts`).
 */
export const PROPORCION_MINIMA = 0.75
export const PROPORCION_MAXIMA = 2.1

export const MENSAJE_FORMA = 'Parece un collage o una foto vertical: sube una foto sola.'

/** La cabecera de la vista previa del documento con los hoteles a los que les faltan fotos. */
export const CABECERA_AVISOS_FOTOS = 'x-avisos-fotos'

/** Lee la cabecera: la lista de avisos, o vacía si no viene o no se entiende. */
export function leerAvisosFotos(valor: string | null | undefined): string[] {
  if (!valor) return []
  try {
    const x = JSON.parse(decodeURIComponent(valor))
    return Array.isArray(x) ? x.filter((t): t is string => typeof t === 'string').slice(0, 20) : []
  } catch {
    return []
  }
}

/** ¿Esta proporción (ancho entre alto) es la de una foto sola? Sin dato, no se frena. */
export function formaAdmitida(proporcion: number | null | undefined): boolean {
  if (proporcion === null || proporcion === undefined) return true
  const p = Number(proporcion)
  if (!Number.isFinite(p) || p <= 0) return true
  return p >= PROPORCION_MINIMA && p <= PROPORCION_MAXIMA
}

/**
 * Cuántos paneles iguales PODRÍA tener una foto demasiado ancha para ser una sola (aprobación de
 * Mauricio del PDF final del 2026-10-29): un díptico o un tríptico del sitio oficial, con cada panel
 * de forma buena, ocupa tantas casillas de la ficha como paneles tenga. Solo la forma: si de verdad
 * está partida en paneles lo dicen los píxeles (`paneles.ts`). De más paneles primero.
 */
export function panelesPosibles(proporcion: number | null | undefined): number[] {
  const p = Number(proporcion)
  if (!Number.isFinite(p) || p <= PROPORCION_MAXIMA) return []
  return [3, 2].filter((n) => formaAdmitida(p / n))
}

/**
 * ¿Puede salir en la ficha? Una foto sola de forma buena, o una que puede ser de paneles iguales.
 * Lo usan la biblioteca y el catálogo, que no tienen los píxeles: el PDF confirma los paneles.
 */
export function formaPosible(proporcion: number | null | undefined): boolean {
  return formaAdmitida(proporcion) || panelesPosibles(proporcion).length > 0
}

/**
 * El orden de las fotos de un hotel en su ficha: fachada (o piscina) primero, luego las que no
 * dicen qué muestran (las de antes del 2026-10-16: la asesora las ordenó a mano y la principal
 * suele ser la fachada), luego habitación, luego zonas comunes, luego «otra». A igual categoría, el
 * orden de la asesora (el de entrada: el `sort` es estable).
 */
const PUESTO_CATEGORIA: Record<string, number> = { fachada: 0, habitacion: 2, zonas_comunes: 3, otra: 4 }

export function puestoDeCategoria(categoria: string | null | undefined): number {
  return categoria ? (PUESTO_CATEGORIA[categoria] ?? 4) : 1
}

export function ordenarPorCategoria<F extends { categoria?: string | null }>(fotos: readonly F[]): F[] {
  return [...fotos].sort((a, b) => puestoDeCategoria(a.categoria) - puestoDeCategoria(b.categoria))
}
