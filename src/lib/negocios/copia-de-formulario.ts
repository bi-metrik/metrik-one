/**
 * Copia readonly de un documento cuyo origen es un FORMULARIO generado.
 *
 * La herencia readonly de documento (`getNegocioDetalleCompleto`, «Herencia readonly de
 * documento») le pinta a la copia el `data` de su origen, buscándolo entre los bloques
 * `documento` del negocio. Un formulario generado deja en su fila lo mismo que la copia
 * necesita para mostrarse: `drive_url`. Así que una copia `documento` con
 * `source_bloque_slug` apuntando a un formulario muestra el PDF generado, en solo lectura,
 * sin un mecanismo nuevo.
 *
 * Caso que lo pide (SOENA, 2026-10-06): el borrador de la carta de autorización
 * (`carta_autorizacion_generar`, Documentación) solo se veía en el historial cerrado de
 * las etapas posteriores. La copia NO genera ni sube nada: es `readonly`, la pantalla la
 * pinta visible y el servidor la rechaza con `copiaDeSoloLectura` (sin `editable_siempre`).
 *
 * Solo por slug: la vía legacy por (etapa, nombre) no se extiende a formularios.
 */

import { esCopiaHeredada } from './copia-heredada'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

/**
 * Slugs de origen de las copias de documento que NO encontraron su origen entre los
 * documentos. Solo esas pueden estar apuntando a un formulario; si no hay ninguna, no se
 * consulta nada.
 */
export function slugsDeCopiasSinOrigen(
  bloques: ReadonlyArray<{ tipo: string | null | undefined; configExtra: Record<string, unknown> | null | undefined }>,
  documentoDataPorSlug: ReadonlyMap<string, unknown>,
): string[] {
  const s = new Set<string>()
  for (const b of bloques) {
    if (b.tipo !== 'documento' || !esCopiaHeredada(b.configExtra)) continue
    const slug = (b.configExtra ?? {}).source_bloque_slug
    if (typeof slug === 'string' && slug.length > 0 && !documentoDataPorSlug.has(slug)) s.add(slug)
  }
  return [...s]
}

/** `data` de los formularios del negocio con esos slugs, indexada por slug. */
export async function formulariosOrigenDeCopias(
  supabase: Cliente,
  negocioId: string,
  slugs: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const m = new Map<string, Record<string, unknown>>()
  if (slugs.length === 0) return m
  const { data, error } = await supabase
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(slug, bloque_definitions!inner(tipo))')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.bloque_definitions.tipo', 'formulario')
    .in('bloque_configs.slug', slugs)
  if (error) {
    // Sin esto la copia se pinta «Sin archivo» con el PDF generado, y nadie sabe por qué.
    console.error('[copia-de-formulario] no se pudo leer el formulario origen:', error)
    return m
  }
  for (const f of ((data ?? []) as Array<{ data: Record<string, unknown> | null; bloque_configs: { slug: string | null } | null }>)) {
    const slug = f.bloque_configs?.slug
    if (slug && f.data) m.set(slug, f.data)
  }
  return m
}
