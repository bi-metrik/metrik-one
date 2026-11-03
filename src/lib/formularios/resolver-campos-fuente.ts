/**
 * Resolución de `campos_fuente` de un formulario: lee los bloques del negocio y saca el
 * valor de cada campo (principal y alternativas). Vivía dentro de `formulario-actions.ts`;
 * salió a un módulo normal para que la vista previa de las plantillas editables resuelva
 * los MISMOS datos sin exponer la función como server action (todo `export async` de un
 * archivo 'use server' es un endpoint).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

export interface FuenteCampo {
  // Referencia ESTABLE al bloque fuente por slug. Prioritaria sobre el par
  // (etapa_orden, bloque_orden), que se rompe al reordenar etapas/bloques y queda
  // como fallback legacy. Ver docs/specs/2026-05-26_block-references-by-slug.md
  bloque_slug?: string
  etapa_orden: number
  bloque_orden: number
  campo_slug?: string // un campo
  campos_slug?: string[] // varios campos concatenados (ej. marca + línea/modelo del certificado)
  join?: string // separador para campos_slug (default " ")
  tipo: string // 'ai' | 'field'
}

export interface CampoFuente {
  slug: string
  // Si `optional`, no se reporta como faltante cuando no hay valor (queda null y
  // la casilla del overlay se dibuja vacía). Ej.: fecha de expedición del 1668,
  // que el banco puede completar a mano.
  optional?: boolean
  source: FuenteCampo
  // Fuentes alternativas: se prueban en orden si la principal no da valor. Útil
  // cuando el dato vive en un bloque condicional (ej. el valor del IVA sale del
  // Contrato de leasing si existe, y si no, de la Factura).
  source_alternatives?: FuenteCampo[]
}

export async function resolverCamposFuente(
  supabase: unknown,
  negocioId: string,
  lineaId: string,
  camposFuente: CampoFuente[],
): Promise<{ datos: Record<string, string | null>; faltantes: string[] }> {
  // Get all negocio_bloques with their config context
  const { data: bloques } = await db(supabase)
    .from('negocio_bloques')
    .select(`
      data,
      bloque_configs!inner(
        orden,
        slug,
        config_extra,
        etapa_id,
        etapas_negocio!inner(orden, linea_id)
      )
    `)
    .eq('negocio_id', negocioId)

  if (!bloques || bloques.length === 0) {
    return { datos: {}, faltantes: camposFuente.map(c => c.slug) }
  }

  // Dos índices: por (etapaOrden:bloqueOrden) legacy y por slug estable.
  const lookup = new Map<string, { data: Record<string, unknown> }>()
  const lookupPorSlug = new Map<string, { data: Record<string, unknown> }>()
  for (const b of bloques) {
    const bc = b.bloque_configs as {
      orden: number
      slug: string | null
      config_extra: Record<string, unknown>
      etapas_negocio: { orden: number; linea_id: string }
    }
    if (bc.etapas_negocio.linea_id !== lineaId) continue
    const entry = { data: (b.data as Record<string, unknown>) ?? {} }
    lookup.set(`${bc.etapas_negocio.orden}:${bc.orden}`, entry)
    if (bc.slug) lookupPorSlug.set(bc.slug, entry)
  }

  // Resuelve el valor de UNA fuente (bloque + campo, o varios concatenados).
  // Vía preferida: slug estable. Fallback legacy: (etapa_orden:bloque_orden).
  const resolverUna = (src: FuenteCampo): string | null => {
    const bloque =
      (src.bloque_slug ? lookupPorSlug.get(src.bloque_slug) : undefined) ??
      lookup.get(`${src.etapa_orden}:${src.bloque_orden}`)
    if (!bloque) return null
    const readOne = (slug: string): string | null => {
      if (src.tipo === 'ai') {
        const campos = bloque.data.campos as Record<string, { value: string | null; confidence: number }> | undefined
        const cd = campos?.[slug]
        return (cd?.value && cd.confidence >= 0.70) ? cd.value : null
      }
      const raw = bloque.data[slug]
      return (raw !== null && raw !== undefined && raw !== '') ? String(raw) : null
    }
    if (src.campos_slug && src.campos_slug.length > 0) {
      const parts = src.campos_slug.map(readOne).filter((v): v is string => !!v)
      return parts.length > 0 ? parts.join(src.join ?? ' ') : null
    }
    return src.campo_slug ? readOne(src.campo_slug) : null
  }

  const datos: Record<string, string | null> = {}
  const faltantes: string[] = []

  for (const campo of camposFuente) {
    // Probar la fuente principal y luego las alternativas; usar la primera con valor.
    let value: string | null = null
    for (const src of [campo.source, ...(campo.source_alternatives ?? [])]) {
      value = resolverUna(src)
      if (value) break
    }
    datos[campo.slug] = value
    if (!value && !campo.optional) faltantes.push(campo.slug)
  }

  return { datos, faltantes }
}
