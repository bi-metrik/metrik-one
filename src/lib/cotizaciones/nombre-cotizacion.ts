/**
 * El nombre corto con el que una comercial distingue una variante de otra dentro
 * del MISMO negocio ("España, 7 días" contra "Portugal, 5 días").
 *
 * Vive en `cotizaciones.descripcion`, una columna que ya existía y que hasta hoy
 * no escribía nadie: las 18 cotizaciones de la base la tienen en null, así que
 * todas se ven con la etiqueta genérica de su modo y dos variantes del mismo
 * negocio son indistinguibles en la lista.
 */

/** Hasta dónde se acepta que un `(N)` final sea un contador de copia y no parte del nombre. */
const TOPE_CONTADOR_COPIA = 99

/** Un `(N)` al final del nombre, con el tronco por delante. */
const SUFIJO_COPIA = /^(.*?)\s*\((\d+)\)$/

/**
 * Deja el nombre listo para comparar: sin espacios de sobra y sin distinguir
 * mayúsculas. NO quita tildes a propósito — "España" y "Espana" son dos nombres
 * que una persona escribió distinto, y fundirlos produciría un "(2)" que nadie pidió.
 */
function paraComparar(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * El nombre que se puede pintar, o `null` si no hay ninguno.
 *
 * Existe porque el vacío llega de DOS formas —`null` de la base y `''` de un campo
 * que alguien borró— y un `??` solo atrapa la primera: con cadena vacía la lista
 * pintaría un nombre en blanco en vez de caer a la etiqueta genérica.
 */
export function nombreMostrable(descripcion: string | null | undefined): string | null {
  const limpio = (descripcion ?? '').trim()
  return limpio === '' ? null : limpio
}

/**
 * El nombre que se le propone a una copia, resuelto contra los nombres que ya
 * existen en el mismo negocio.
 *
 * - Si el original no tiene nombre, la copia tampoco: no se inventa uno donde no había.
 * - Si lo tiene, se le cuelga el primer `(N)` libre empezando en 2.
 * - Un original que YA es una copia no encadena sufijos: "España (2)" propone "España (3)".
 *
 * `existentes` se pasa completo, incluido el nombre del propio original; que el
 * original ocupe su lugar es justamente lo que empuja la propuesta al (2).
 */
export function nombreParaDuplicado(
  original: string | null | undefined,
  existentes: readonly (string | null | undefined)[],
): string | null {
  const nombre = nombreMostrable(original)
  if (nombre === null) return null

  // Un nombre que ya termina en "(3)" vuelve a su tronco para no acumular sufijos.
  // El tope evita comerse un paréntesis que es parte del nombre y no un contador:
  // "Modelo 500 (2024)" conserva el año y se convierte en "Modelo 500 (2024) (2)".
  const match = SUFIJO_COPIA.exec(nombre)
  const tronco = match && Number(match[2]) <= TOPE_CONTADOR_COPIA && match[1].trim() !== ''
    ? match[1].trim()
    : nombre

  const ocupados = new Set(
    existentes
      .map(e => nombreMostrable(e))
      .filter((e): e is string => e !== null)
      .map(paraComparar),
  )

  let n = 2
  while (ocupados.has(paraComparar(`${tronco} (${n})`))) n++
  return `${tronco} (${n})`
}
