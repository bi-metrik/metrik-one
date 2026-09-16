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
 *
 * Una línea creada con un botón de tipo («+ Vuelo», «+ Hotel») nace llamándose como la
 * etiqueta de su grupo. Ese nombre también es relleno, pero SOLO en una línea de ese grupo:
 * «Vuelo» a secas, sin saber el grupo, sigue contando como escrito por alguien.
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

/**
 * El nombre provisional con que nace una línea creada desde un botón de tipo: la etiqueta
 * de su grupo («Vuelo», «Hotel»). Vive aquí para que el relleno y su detección no se
 * desincronicen.
 */
export function nombreProvisionalDeGrupo(etiquetaGrupo: string): string {
  return etiquetaGrupo
}

/** Lo que pinta el editor cuando la línea no tiene nombre. */
const SIN_NOMBRE = 'item sin nombre'

function normalizar(nombre: string | null | undefined): string {
  return (nombre ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * ¿El nombre de la línea es un relleno y no una decisión de la persona?
 *
 * Relleno: vacío, el «Item sin nombre» del editor, el nombre de alternativa que pone el
 * sistema, o (si se sabe el grupo de la línea) el nombre provisional de ese grupo. Todo lo
 * demás cuenta como escrito por alguien.
 */
export function esNombreDeRelleno(nombre: string | null | undefined, etiquetaGrupo?: string | null): boolean {
  const n = normalizar(nombre)
  if (!n) return true
  if (n === SIN_NOMBRE) return true
  if (etiquetaGrupo && n === normalizar(nombreProvisionalDeGrupo(etiquetaGrupo))) return true
  return n.endsWith(SUFIJO_ALTERNATIVA)
}

/**
 * El nombre que se escribe al confirmar el costo leído de un pantallazo, o `null` si no
 * se toca.
 *
 * - La lectura no trajo nombre (vacío, o la etiqueta genérica de la ranura: «Hotel»,
 *   «Vuelo») → `null`. Una liquidación sin nombre de hotel no le pone «Hotel» a nadie.
 * - La línea tiene nombre propio → `null`.
 * - La línea no tiene nombre propio (incluido el provisional de su grupo) → el leído.
 */
export function nombreAlConfirmarLectura(args: {
  nombreActual: string | null | undefined
  nombreLeido: string | null | undefined
  etiquetaRanura: string
}): string | null {
  const leido = (args.nombreLeido ?? '').trim()
  if (!leido || leido === args.etiquetaRanura) return null
  if (!esNombreDeRelleno(args.nombreActual, args.etiquetaRanura)) return null
  return leido
}
