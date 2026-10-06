/**
 * Distintivos de mención de un comentario del timeline.
 *
 * Desde el 2026-10-06 un comentario con menciones nuevas guarda `mencion_id = null` (ese
 * campo disparaba un segundo aviso, ver `addComment`), así que la lista sale de
 * `activity_menciones`. Los comentarios viejos solo tienen `mencion_id`: ahí manda él.
 */
export function etiquetasDeMencion(entry: {
  mencion: { full_name: string } | null
  menciones?: string[]
}): string[] {
  if (entry.menciones && entry.menciones.length > 0) return [...new Set(entry.menciones)]
  return entry.mencion ? [entry.mencion.full_name] : []
}
