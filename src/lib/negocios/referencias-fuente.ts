/**
 * Referencias al bloque FUENTE que un bloque declara en su `config_extra`.
 *
 * Un bloque puede apuntar a otro para tres cosas: decidir si se muestra
 * (`condition`), autollenar un campo (`auto_fill`) o bloquear/forzar un valor
 * (`lock_when`). El origen se declara de dos formas:
 *
 *   - `source_bloque_slug` — identidad estable, vía preferida (ver
 *     `docs/specs/2026-05-26_block-references-by-slug.md`)
 *   - `source_etapa_orden` — el orden de la etapa donde vive, vía legacy
 *
 * ⚠️ Las dos hay que recolectarlas. `datosPorSlug` se poblaba SOLO con los
 * bloques de las etapas recogidas por `source_etapa_orden`, así que una
 * referencia que declaraba únicamente el slug no encontraba su origen: el
 * índice por slug salía vacío y la condición caía al bag de la etapa actual,
 * donde el campo no existe. El bloque quedaba invisible en pantalla mientras
 * su gate —que en SQL sí resuelve el slug dentro de la línea— seguía
 * exigiéndolo. Ver `condicion_cumplida` en la base: esa es la semántica que
 * este módulo replica del lado del servidor.
 */

// Solo se declaran las dos claves que apuntan al ORIGEN. El resto de la
// referencia (`field`, `value`, `mapping`…) lo interpreta cada consumidor;
// aquí solo importa de qué bloque hay que traer el dato.
type ReferenciaFuente = {
  source_etapa_orden?: number
  source_bloque_slug?: string
  [otras: string]: unknown
}

type ConfigExtraConReferencias = {
  condition?: ReferenciaFuente | null
  fields?: Array<{
    auto_fill?: ReferenciaFuente | null
    lock_when?: ReferenciaFuente | null
  }> | null
} | null | undefined

export type ReferenciasFuente = {
  etapaOrdens: Set<number>
  bloqueSlugs: Set<string>
}

/** Recolecta, de un conjunto de `config_extra`, ambas formas de referenciar el bloque fuente. */
export function recolectarReferenciasFuente(
  configs: Iterable<ConfigExtraConReferencias>
): ReferenciasFuente {
  const etapaOrdens = new Set<number>()
  const bloqueSlugs = new Set<string>()

  const registrar = (ref: ReferenciaFuente | null | undefined) => {
    if (!ref) return
    if (ref.source_etapa_orden) etapaOrdens.add(ref.source_etapa_orden)
    if (ref.source_bloque_slug) bloqueSlugs.add(ref.source_bloque_slug)
  }

  for (const ce of configs) {
    registrar(ce?.condition)
    for (const f of ce?.fields ?? []) {
      registrar(f?.auto_fill)
      registrar(f?.lock_when)
    }
  }

  return { etapaOrdens, bloqueSlugs }
}

/**
 * Aplana el `data` de un bloque para consulta por campo: los campos extraídos
 * por IA viven anidados en `data.campos[slug].value` y las condiciones los
 * leen al mismo nivel que el resto. Mismo criterio que usa `condicion_cumplida`.
 */
export function aplanarDataBloque(data: Record<string, unknown> | null): Record<string, unknown> {
  const plano: Record<string, unknown> = { ...(data ?? {}) }
  const campos = data?.campos as Record<string, { value: string | null }> | undefined
  if (campos) {
    for (const [slug, campo] of Object.entries(campos)) {
      if (campo?.value !== null && campo?.value !== undefined) plano[slug] = campo.value
    }
  }
  return plano
}
