import { llavesDeHerenciaDocumento } from './herencia-documento'

/**
 * ¿De qué fila hereda una casilla que acaba de nacer al entrar a una etapa?
 *
 * Vive fuera de `cambiarEtapaNegocio` para poder probarla con la forma real de los datos.
 *
 * ## Una copia nunca alimenta la herencia
 *
 * Cada bloque se declara una vez en su etapa nativa (el ORIGEN) y se repite como copia de
 * solo lectura en las etapas siguientes. Cada copia tiene su propia fila. Hasta el
 * 2026-09-14 el índice de herencia se armaba con TODAS las filas `completo` del negocio,
 * copias incluidas, y un `Map.set` se quedaba con la última que leía. Dos consecuencias,
 * medidas en SOENA ese día sobre «Factura emitida»:
 *
 * - **Sin original lleno, una copia sucia vieja (de antes del #575) era la única entrada
 *   con su llave, y cada copia nueva la heredaba.** Se perpetuaba sola: a V0475 le nacieron
 *   dos copias con `CertificadoVehiculosElectricos (17).pdf` adentro el mismo día.
 * - **Con el original bien, igual podía ganar una copia sucia leída después.** No se veía
 *   porque el render cambia la data de la copia por la del origen, pero la fila quedaba
 *   sucia (173 negocios) y la cola de facturación la leía.
 *
 * Ahora solo cuentan los orígenes (`esCopiaHeredada` = false). Aplica igual a `documento`,
 * `datos` y a los tipos con `definition_id` propio (propuesta, cotización, checklists).
 *
 * ## Una copia de documento hereda el ARCHIVO de su origen, o nada
 *
 * Mismo criterio que `documentoHeredadoNaceCompleto`, pero exigiendo que el archivo sea el
 * del origen y no uno cualquiera. Se resuelve por `source_bloque_slug` contra la fila del
 * origen en CUALQUIER estado: 272 de las 274 facturas originales de SOENA con archivo están
 * en `pendiente`, porque `archivarPdfEnBloque` escribe la data sin tocar el estado. Si el
 * origen no tiene archivo (o no existe), la copia nace vacía y pendiente.
 */

export interface ConfigDeFila {
  bloque_definition_id: string | null
  nombre: string | null
  estado: string | null
  slug?: string | null
  config_extra: Record<string, unknown> | null
  tipo: string | null
}

/** Una fila de `negocio_bloques` del negocio, con la config que la gobierna. */
export interface FilaDelNegocio {
  id: string
  estado: string
  data: Record<string, unknown> | null
  completado_at: string | null
  config: ConfigDeFila
}

export interface FuenteHerencia {
  id: string
  data: Record<string, unknown>
  completado_at: string | null
}

export interface IndicesHerencia {
  /** Tipos cuyo `definition_id` identifica al bloque (propuesta, cotización, checklist…). */
  porDef: Map<string, FuenteHerencia>
  /** `documento` por `{def}:{label}` y `{def}:{nombre}`; `datos` por `{def}:{nombre}`. */
  porLlave: Map<string, FuenteHerencia>
}

/**
 * ¿Esta configuración es una copia de solo lectura de un bloque de otra etapa?
 *
 * Visible y con referencia a su origen. Un editable con referencia de origen NO es copia:
 * es una casilla compartida, que escribe en su origen y no hereda nada.
 */
export function esCopiaHeredada(
  cfg: { estado?: string | null; config_extra?: Record<string, unknown> | null },
): boolean {
  const ce = cfg.config_extra ?? {}
  return cfg.estado === 'visible'
    && (ce.source_etapa_orden != null || (typeof ce.source_bloque_slug === 'string' && ce.source_bloque_slug !== ''))
}

/** ¿La data de un documento trae un archivo? */
export function documentoTieneArchivo(data: Record<string, unknown> | null | undefined): boolean {
  const url = data?.drive_url
  return typeof url === 'string' && url.trim() !== ''
}

/** Filas de ORIGEN indexadas por su slug. Las copias no tienen slug. */
export function origenesPorSlugDe(filas: FilaDelNegocio[]): Map<string, FilaDelNegocio> {
  const m = new Map<string, FilaDelNegocio>()
  for (const f of filas) {
    if (f.config.slug && !esCopiaHeredada(f.config)) m.set(f.config.slug, f)
  }
  return m
}

/** Índices de herencia con las filas `completo` que son ORIGEN. Las copias no entran. */
export function indicesDeHerencia(filas: FilaDelNegocio[]): IndicesHerencia {
  const porDef = new Map<string, FuenteHerencia>()
  const porLlave = new Map<string, FuenteHerencia>()
  for (const f of filas) {
    if (f.estado !== 'completo') continue
    if (esCopiaHeredada(f.config)) continue
    const defId = f.config.bloque_definition_id
    if (!defId) continue
    const entry: FuenteHerencia = { id: f.id, data: f.data ?? {}, completado_at: f.completado_at }
    porDef.set(defId, entry)
    if (f.config.tipo === 'documento') {
      const label = f.config.config_extra?.label as string | null | undefined
      if (label) porLlave.set(`${defId}:${label}`, entry)
      // Segunda llave por nombre, para los documentos que no declaran `label`.
      if (f.config.nombre) porLlave.set(`${defId}:${f.config.nombre}`, entry)
    }
    if (f.config.tipo === 'datos' && f.config.nombre) {
      porLlave.set(`${defId}:${f.config.nombre}`, entry)
    }
  }
  return { porDef, porLlave }
}

export interface CasillaNueva {
  bloque_definition_id: string
  estado: string
  nombre: string | null
  config_extra: Record<string, unknown> | null
  tipo: string | null | undefined
}

/**
 * La fila de la que hereda `bc`, o `undefined` si nace vacía.
 *
 * @param origenesPorSlug filas de origen del negocio por slug, en cualquier estado.
 *   Basta con las que referencian las copias de documento que van a nacer.
 */
export function fuenteDeHerencia(
  bc: CasillaNueva,
  indices: IndicesHerencia,
  origenesPorSlug: Map<string, FilaDelNegocio>,
): FuenteHerencia | undefined {
  const isVisible = bc.estado === 'visible'
  const label = bc.config_extra?.label as string | null | undefined

  if (bc.tipo === 'documento') {
    if (isVisible) {
      const srcSlug = bc.config_extra?.source_bloque_slug
      if (typeof srcSlug === 'string' && srcSlug !== '') {
        const origen = origenesPorSlug.get(srcSlug)
        if (!origen || !documentoTieneArchivo(origen.data)) return undefined
        return { id: origen.id, data: origen.data ?? {}, completado_at: origen.completado_at }
      }
      // Copia sin slug (legacy): por label y nombre, solo contra orígenes, y con archivo.
      for (const llave of llavesDeHerenciaDocumento(bc.bloque_definition_id, label, bc.nombre)) {
        const f = indices.porLlave.get(llave)
        if (f) return documentoTieneArchivo(f.data) ? f : undefined
      }
      return undefined
    }
    // Casilla editable: solo por `label`. Ver `llavesDeHerenciaDocumento`.
    for (const llave of llavesDeHerenciaDocumento(bc.bloque_definition_id, label)) {
      const f = indices.porLlave.get(llave)
      if (f) return f
    }
    return undefined
  }

  if (isVisible) {
    if (bc.tipo === 'datos') {
      return bc.nombre ? indices.porLlave.get(`${bc.bloque_definition_id}:${bc.nombre}`) : undefined
    }
    return indices.porDef.get(bc.bloque_definition_id)
  }

  if (bc.tipo === 'cotizacion') return indices.porDef.get(bc.bloque_definition_id)
  return undefined
}
