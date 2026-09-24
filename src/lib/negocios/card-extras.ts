/**
 * Campos extra de la tarjeta del negocio y del Excel de /negocios
 * (`workspaces.config_extra.negocio_card.campos_extra`).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────────────
 * Hay datos que el equipo necesita ver en la LISTA, no solo al abrir el negocio. El caso
 * que lo trajo es la titularidad de SOENA (Único / Copropiedad / Leasing y los nombres de
 * los titulares): hasta aquí solo salía en la tarjeta de datos clave de la ficha, así que
 * para saber cuáles casos eran copropiedad había que abrirlos uno por uno.
 *
 * ── Las reglas ─────────────────────────────────────────────────────────────────────
 * - Genérico y declarado por la configuración: cada entrada lleva `label`,
 *   `source_bloque_slug`, `field`, `etiquetas?` y `detalle?`, la misma forma que las
 *   entradas de `datos_clave` (`datos-clave.ts`). Nada de un cliente escrito aquí.
 * - Se lee con la MISMA RPC de la tarjeta (`negocio_bloques_campos_json`), en la misma
 *   llamada y sin consultas por negocio. Esa RPC indexa por el NOMBRE del bloque, así que
 *   el slug se traduce a nombre con una sola lectura de `bloque_configs` por carga.
 * - A diferencia de la tarjeta de datos clave, aquí NO se evalúa si el bloque le aplica
 *   al caso (`condicion_cumplida` por negocio es demasiado pesado para una lista). Lo
 *   reemplaza `solo_si` en cada línea de detalle: una condición sobre otro campo que
 *   también viaja en la RPC. Es lo que evita que el RUT del segundo titular, que sobró
 *   en un caso corregido a «único», aparezca como titular.
 * - Un campo sin valor no se pinta en la tarjeta (es una lista, no la ficha) y en el
 *   Excel deja la celda vacía.
 */

import { normalizarClave } from './fuentes-negocio'
import type { ParCampo } from './campos-de-bloques'

/** Condición sobre otro campo: la misma forma que una `condition` de bloque. */
export interface CondicionCampoExtra {
  source_bloque_slug: string
  field: string
  value?: string
  value_in?: string[]
}

export interface DetalleCampoExtra {
  source_bloque_slug: string
  field: string
  /** La línea solo se muestra si esta condición se cumple. */
  solo_si?: CondicionCampoExtra
}

export interface CampoExtraCard {
  label: string
  source_bloque_slug: string
  field: string
  /** Texto por valor crudo. Sin entrada, sale el valor tal cual. */
  etiquetas?: Record<string, string>
  /** Líneas que acompañan al valor (los nombres de los titulares). */
  detalle?: DetalleCampoExtra[]
  /** Encabezado de la columna del detalle en el Excel. Por defecto «{label} (detalle)». */
  detalle_label?: string
}

/** Un campo extra resuelto para un negocio. Solo existe si el campo tiene valor. */
export interface ExtraCard {
  /** Posición del campo en la configuración: la columna del Excel lo busca por aquí. */
  indice: number
  label: string
  valor: string
  detalle: string[]
}

const noVacio = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function esCondicion(v: unknown): v is CondicionCampoExtra {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  if (!noVacio(c.source_bloque_slug) || !noVacio(c.field)) return false
  const conValue = c.value !== undefined && c.value !== null
  const conValueIn = Array.isArray(c.value_in) && c.value_in.length > 0
  return conValue || conValueIn
}

function leerDetalle(v: unknown): DetalleCampoExtra | null {
  if (typeof v !== 'object' || v === null) return null
  const d = v as Record<string, unknown>
  if (!noVacio(d.source_bloque_slug) || !noVacio(d.field)) return null
  // Una `solo_si` mal escrita NO se ignora: se descarta la línea. Mostrarla sin la
  // condición es justo el error que la condición existe para evitar.
  if (d.solo_si !== undefined && !esCondicion(d.solo_si)) return null
  return {
    source_bloque_slug: d.source_bloque_slug,
    field: d.field,
    ...(d.solo_si ? { solo_si: d.solo_si as CondicionCampoExtra } : {}),
  }
}

/** Los campos extra que declara `negocio_card`, o `[]` si no declara ninguno. */
export function leerCamposExtra(negocioCard: unknown): CampoExtraCard[] {
  const crudo = (negocioCard as { campos_extra?: unknown } | null | undefined)?.campos_extra
  if (!Array.isArray(crudo)) return []
  const campos: CampoExtraCard[] = []
  for (const v of crudo) {
    if (typeof v !== 'object' || v === null) continue
    const c = v as Record<string, unknown>
    if (!noVacio(c.label) || !noVacio(c.source_bloque_slug) || !noVacio(c.field)) continue
    const etiquetas =
      c.etiquetas && typeof c.etiquetas === 'object' && !Array.isArray(c.etiquetas)
        ? (c.etiquetas as Record<string, string>)
        : undefined
    const detalle = Array.isArray(c.detalle)
      ? c.detalle.map(leerDetalle).filter((d): d is DetalleCampoExtra => d !== null)
      : []
    campos.push({
      label: c.label.trim(),
      source_bloque_slug: c.source_bloque_slug,
      field: c.field,
      ...(etiquetas ? { etiquetas } : {}),
      detalle,
      ...(noVacio(c.detalle_label) ? { detalle_label: c.detalle_label.trim() } : {}),
    })
  }
  return campos
}

/** Todas las (slug, campo) que hay que leer: valor, detalle y condiciones del detalle. */
function fuentes(campos: readonly CampoExtraCard[]): Array<{ slug: string; field: string }> {
  const out: Array<{ slug: string; field: string }> = []
  for (const c of campos) {
    out.push({ slug: c.source_bloque_slug, field: c.field })
    for (const d of c.detalle ?? []) {
      out.push({ slug: d.source_bloque_slug, field: d.field })
      if (d.solo_si) out.push({ slug: d.solo_si.source_bloque_slug, field: d.solo_si.field })
    }
  }
  return out
}

/** Los slugs de bloque que hay que traducir a nombre. */
export function slugsDeCamposExtra(campos: readonly CampoExtraCard[]): string[] {
  return [...new Set(fuentes(campos).map(f => f.slug))]
}

/**
 * Los pares (nombre de bloque, campo) para la RPC. Un slug que no existe en el
 * workspace no aporta pares: su campo sale vacío, como el de un negocio sin el dato.
 */
export function paresDeCamposExtra(
  campos: readonly CampoExtraCard[],
  nombresPorSlug: ReadonlyMap<string, readonly string[]>,
): ParCampo[] {
  const pares: ParCampo[] = []
  for (const f of fuentes(campos)) {
    for (const bloque of nombresPorSlug.get(f.slug) ?? []) pares.push({ bloque, campo: f.field })
  }
  return pares
}

/** Lector de un campo del negocio por slug (ya traducido a nombre por quien lo arma). */
export type LectorPorSlug = (slug: string, field: string) => string | null

function cumple(cond: CondicionCampoExtra, leer: LectorPorSlug): boolean {
  const v = leer(cond.source_bloque_slug, cond.field)
  if (v === null) return false
  const clave = normalizarClave(v)
  if (cond.value !== undefined && cond.value !== null) return clave === normalizarClave(cond.value)
  return (cond.value_in ?? []).some(x => normalizarClave(x) === clave)
}

/** Los campos extra de UN negocio, en el orden de la configuración. */
export function resolverExtras(campos: readonly CampoExtraCard[], leer: LectorPorSlug): ExtraCard[] {
  const out: ExtraCard[] = []
  campos.forEach((c, indice) => {
    const crudo = leer(c.source_bloque_slug, c.field)
    if (crudo === null) return
    const valor = c.etiquetas?.[crudo] ?? c.etiquetas?.[normalizarClave(crudo)] ?? crudo
    const detalle: string[] = []
    for (const d of c.detalle ?? []) {
      if (d.solo_si && !cumple(d.solo_si, leer)) continue
      const v = leer(d.source_bloque_slug, d.field)
      if (v !== null) detalle.push(v)
    }
    out.push({ indice, label: c.label, valor, detalle })
  })
  return out
}

/** «Copropiedad · Ana Pérez, Luis Gómez». */
export function textoExtra(e: ExtraCard): string {
  return e.detalle.length > 0 ? `${e.valor} · ${e.detalle.join(', ')}` : e.valor
}

// ── Excel ────────────────────────────────────────────────────────────────────

/** Una columna del Excel que sale de un campo extra. */
export interface ColumnaExtra {
  encabezado: string
  campo: number
  parte: 'valor' | 'detalle'
}

/**
 * Las columnas extra, después de las fijas: una por campo y otra por su detalle si lo
 * declara. Un encabezado que choca con uno ya usado se numera: dos columnas con el mismo
 * nombre en una hoja se pisan al leerla como tabla.
 */
export function columnasExtra(campos: readonly CampoExtraCard[], ocupados: readonly string[]): ColumnaExtra[] {
  const usados = new Set(ocupados)
  const unico = (base: string) => {
    let nombre = base
    for (let i = 2; usados.has(nombre); i++) nombre = `${base} (${i})`
    usados.add(nombre)
    return nombre
  }
  const cols: ColumnaExtra[] = []
  campos.forEach((c, i) => {
    cols.push({ encabezado: unico(c.label), campo: i, parte: 'valor' })
    if ((c.detalle ?? []).length > 0) {
      cols.push({ encabezado: unico(c.detalle_label ?? `${c.label} (detalle)`), campo: i, parte: 'detalle' })
    }
  })
  return cols
}
