/**
 * El nombre de una LÍNEA de cotización (`items.nombre`) frente al que propone la lectura
 * de un pantallazo.
 *
 * ## La regla
 *
 * Si la línea ya tiene un nombre que escribió la persona, la lectura NO lo toca. Solo
 * propone nombre cuando la línea no tiene uno propio: vacía, o con un relleno que puso
 * el sistema. Caso real (Trappvel, 2026-09-16): la línea «PRUEBA Vuelo LATAM» quedó
 * «LATAM Bogotá BOG–Orlando MCO» al confirmar el costo. Ese nombre es lo que imprime el
 * PDF y lo que distingue una alternativa de otra: pisarlo borra una decisión de quien
 * cotiza sin que nada lo avise.
 */

/**
 * Lo que `agregarOpcionAItem` le pega al nombre del titular cuando la alternativa nace
 * sin nombre. Vive aquí para que el relleno y su detección no se desincronicen.
 */
export const SUFIJO_ALTERNATIVA = '(alternativa)'

/** El nombre con que nace una alternativa a la que nadie le ha puesto nombre. */
export function nombreDeAlternativa(nombreTitular: string | null | undefined): string {
  return `${nombreTitular ?? 'Opción'} ${SUFIJO_ALTERNATIVA}`
}

/** Lo que pinta el editor cuando la línea no tiene nombre. */
const SIN_NOMBRE = 'item sin nombre'

/**
 * ¿El nombre de la línea es un relleno y no una decisión de la persona?
 *
 * Relleno: vacío, el «Item sin nombre» del editor, o el nombre de alternativa que pone el
 * sistema. Todo lo demás cuenta como escrito por alguien.
 */
export function esNombreDeRelleno(nombre: string | null | undefined): boolean {
  const n = (nombre ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!n) return true
  if (n === SIN_NOMBRE) return true
  return n.endsWith(SUFIJO_ALTERNATIVA)
}

/**
 * El nombre que se escribe al confirmar el costo leído de un pantallazo, o `null` si no
 * se toca.
 *
 * - La lectura no trajo nombre (vacío, o la etiqueta genérica de la ranura: «Hotel»,
 *   «Vuelo») → `null`. Una liquidación sin nombre de hotel no le pone «Hotel» a nadie.
 * - La línea tiene nombre propio → `null`.
 * - La línea no tiene nombre propio → el leído.
 */
export function nombreAlConfirmarLectura(args: {
  nombreActual: string | null | undefined
  nombreLeido: string | null | undefined
  etiquetaRanura: string
}): string | null {
  const leido = (args.nombreLeido ?? '').trim()
  if (!leido || leido === args.etiquetaRanura) return null
  if (!esNombreDeRelleno(args.nombreActual)) return null
  return leido
}
