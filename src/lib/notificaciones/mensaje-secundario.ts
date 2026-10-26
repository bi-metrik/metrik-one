/**
 * Segunda línea de un aviso en la campanita: `metadata.mensaje`, cuando existe.
 *
 * El título (`contenido`) dice QUÉ pasó ("Te asignaron A1 26 1 · Cancún"); el mensaje dice
 * QUIÉN o POR QUÉ ("<persona> te dejó como responsable (operaciones) de este negocio.").
 * Lo escriben los triggers `avisar_asignacion_responsable` (tipo `asignacion_responsable`) y
 * el aviso de entrada a etapa (tipo `negocio_en_etapa`); el correo ya lo mostraba y la
 * campana no.
 *
 * `metadata` es jsonb libre: solo vale un texto no vacío, y no se repite si dice lo mismo
 * que el título (una config de etapa podría declarar ambos iguales).
 */
export function mensajeSecundario(metadata: unknown, contenido: string | null | undefined): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const m = (metadata as Record<string, unknown>).mensaje
  if (typeof m !== 'string') return null
  const texto = m.trim()
  if (!texto) return null
  if (texto === (contenido ?? '').trim()) return null
  return texto
}
