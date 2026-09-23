/**
 * Filtro `.or()` de PostgREST para buscar un negocio por código o nombre.
 *
 * El término lo escribe una persona, y dentro de `.or()` varios caracteres tienen
 * significado: la coma separa condiciones, los paréntesis agrupan, el punto y los dos
 * puntos separan operador y valor. Pegado tal cual, «Pérez, Juan» parte el filtro en dos
 * y PostgREST responde con error (o, peor, con otra consulta). Además `%` y `_` son
 * comodines de LIKE: «10%» traería cualquier cosa que empiece por 10.
 *
 * Dos capas de escape, en este orden:
 *   1. LIKE: `\` → `\\`, `%` → `\%`, `_` → `\_` (el escape por defecto de Postgres es `\`).
 *   2. PostgREST: el valor va entre comillas dobles, y adentro `\` y `"` se escapan con `\`.
 *      Entre comillas, la coma, los paréntesis y el punto dejan de ser sintaxis.
 *
 * Puro: no toca DB ni red.
 */

/** Largo mínimo del término: con una letra la lista no sirve para escoger. */
export const BUSQUEDA_NEGOCIO_MIN = 2
/** Techo del término: nadie busca un negocio con un párrafo. */
const BUSQUEDA_NEGOCIO_MAX = 80

/** Escapa los comodines de LIKE para que el término se busque literal. */
export function escaparLike(termino: string): string {
  return termino.replace(/[\\%_]/g, c => `\\${c}`)
}

/** Envuelve un valor entre comillas dobles, con el escape que entiende PostgREST. */
export function valorEntreComillas(valor: string): string {
  return `"${valor.replace(/[\\"]/g, c => `\\${c}`)}"`
}

/**
 * El filtro listo para `.or()`, o `null` si el término no alcanza para buscar.
 */
export function filtroBusquedaNegocio(termino: string): string | null {
  const limpio = (termino ?? '').trim().slice(0, BUSQUEDA_NEGOCIO_MAX)
  if (limpio.length < BUSQUEDA_NEGOCIO_MIN) return null
  const patron = valorEntreComillas(`%${escaparLike(limpio)}%`)
  return `codigo.ilike.${patron},nombre.ilike.${patron}`
}
