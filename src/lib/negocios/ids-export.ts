/**
 * Validacion de la lista de ids que el navegador manda para exportar la tabla de
 * negocios.
 *
 * Vive aparte porque la comparten las DOS superficies de exportacion (la descarga por
 * `POST /api/negocios/export` y la subida a Drive). Copiado en los dos lados, el dia que
 * alguien suba el tope o afloje el largo del id solo lo hace en uno, y la superficie que
 * quede corta rechaza en silencio lo que la otra acepta.
 *
 * Puro: sin red, sin Supabase.
 */

/** Tope de negocios por archivo. Por encima, es un filtro que se olvido. */
export const MAX_IDS_EXPORT = 5000

/**
 * Devuelve los ids limpios y sin repetir, o `null` si el cuerpo no sirve.
 *
 * Conserva el ORDEN en que llegaron: es el orden de la pantalla, y de ahi sale el orden
 * de las filas del archivo.
 */
export function leerIdsExport(body: unknown): string[] | null {
  const ids = (body as { ids?: unknown } | null)?.ids
  if (!Array.isArray(ids)) return null
  if (ids.length === 0 || ids.length > MAX_IDS_EXPORT) return null
  const limpios = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null
    limpios.add(id)
  }
  return Array.from(limpios)
}
