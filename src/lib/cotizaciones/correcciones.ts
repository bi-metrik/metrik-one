/**
 * Lo que una persona corrige de lo que leyó la IA en un pantallazo.
 *
 * Brief del 2026-09-22: *«todos los campos extraídos con IA dentro de la cotización deben
 * poderse editar por el usuario para aquellos casos donde lo que se extrae no corresponde con
 * la realidad»*.
 *
 * ## Lo que dijo la IA no se pierde nunca
 *
 * Es la regla que ya rige el margen por ítem (#794): el margen que puso la captura queda en
 * `tarifa_pax.confirmada.margenProveedor` y el que manda está en `items.margen_porcentaje`.
 * Aquí es lo mismo, campo por campo:
 *
 *  · lo leído sigue en `tarifa_pax.casillas.<clave>.campos`, intacto;
 *  · lo corregido va en `tarifa_pax.correcciones[slug]`, con quién y cuándo;
 *  · el documento usa lo corregido (`aplicarCorrecciones`, `detalle-viaje.ts`).
 *
 * ## Releer la captura no pisa una corrección
 *
 * Volver a pegar un pantallazo REEMPLAZA su casilla entera (`leerCasillaDeItem`). Por eso las
 * correcciones viven FUERA de las casillas, a nivel de la línea: la lectura nueva queda como
 * la nueva «lo que dijo la IA», y lo que escribió la persona sigue mandando. Para volver a lo
 * leído hay un botón por campo; nada lo hace solo.
 *
 * ## Qué se corrige aquí y qué no
 *
 * ⚠️ Los campos que entran al COSTO (moneda, precio, base del precio, lo que paga la agencia,
 * comisión, pasajeros y ocupación) NO se corrigen en la ficha. Ya tienen dónde corregirse, y
 * ahí la IA también queda guardada aparte: el costo en los rubros de la línea, la ocupación
 * en «Cambiar pasajeros de esta línea» y el margen en el margen de la línea. Corregirlos
 * además aquí haría pasar un número tecleado por el cálculo de la tarifa (`resolverTarifa`),
 * que es exactamente lo que el brief pide no tocar. Ver `CAMPOS_DE_COSTO`.
 *
 * Módulo puro: sin red, sin base.
 */

import type { CampoRanura, DefinicionRanura } from './ranuras-pantallazo'

/** Una corrección de una persona sobre un campo leído. */
export interface CorreccionCampo {
  /**
   * El valor que escribió la persona, ya normalizado (`validarCorreccion`, `ficha-linea.ts`).
   * `null` = la persona dejó el campo VACÍO a propósito: la lectura traía algo que no es
   * cierto y no hay nada que poner en su lugar.
   */
  valor: string | null
  /** Nombre de quien corrigió. */
  por: string | null
  /** `profiles.id` de quien corrigió. */
  porId: string | null
  /** Cuándo (ISO, reloj del servidor). */
  en: string
}

export type Correcciones = Record<string, CorreccionCampo>

/**
 * Los campos que alimentan el costo. No se corrigen en la ficha: ver la cabecera.
 *
 * ⚠️ Lista CERRADA y a propósito: un campo nuevo de una ranura nace corregible en la ficha
 * salvo que alguien decida que entra al costo y lo agregue aquí.
 */
export const CAMPOS_DE_COSTO: readonly string[] = [
  'moneda',
  'precio_total',
  'base_precio',
  'total_a_pagar_agencia',
  'comision_agencia_valor',
  'comision_agencia_pct',
  'precio_por_pax',
  'pax',
  'ocupacion_adultos',
  'ocupacion_ninos',
  'ocupacion_infantes',
  'ocupacion_total',
]

/** Los campos de la ranura que se corrigen en la ficha de la línea, en su orden. */
export function camposCorregibles(ranura: DefinicionRanura): CampoRanura[] {
  return ranura.campos.filter(c => !CAMPOS_DE_COSTO.includes(c.slug))
}

/** ¿Este campo de esta ranura se corrige en la ficha? */
export function esCorregible(ranura: DefinicionRanura, slug: string): boolean {
  return camposCorregibles(ranura).some(c => c.slug === slug)
}

/** Lee `tarifa_pax.correcciones` sin confiar en su forma: lo que no se entiende se descarta. */
export function leerCorrecciones(raw: unknown): Correcciones {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Correcciones = {}
  for (const [slug, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const c = v as Record<string, unknown>
    if (typeof c.en !== 'string') continue
    if (c.valor !== null && typeof c.valor !== 'string') continue
    out[slug] = {
      valor: c.valor as string | null,
      por: typeof c.por === 'string' ? c.por : null,
      porId: typeof c.porId === 'string' ? c.porId : null,
      en: c.en,
    }
  }
  return out
}

/**
 * Lo leído, con lo corregido encima. Recibe y devuelve el detalle por slug.
 *
 * Una corrección con `valor: null` BORRA el dato leído: la persona dijo que no es cierto.
 * No toca el objeto de entrada.
 */
export function aplicarCorrecciones(
  leido: Record<string, string>,
  correcciones: Correcciones | null | undefined,
): Record<string, string> {
  const out = { ...leido }
  for (const [slug, c] of Object.entries(correcciones ?? {})) {
    if (c.valor === null || c.valor.trim() === '') delete out[slug]
    else out[slug] = c.valor
  }
  return out
}

/**
 * Los campos leídos de UNA lectura, de vuelta a sus slugs.
 *
 * `LecturaCasilla.campos` guarda `{ label, valor }` y no el slug; la vuelta se hace contra el
 * catálogo de la ranura, que es donde los dos viven juntos. Un valor marcado «(del viaje)» no
 * salió de la imagen sino del ítem (regla 7.4): para el dato vale igual, así que se le quita
 * el marcador, que es vocabulario interno.
 */
export function leidosPorSlug(
  ranura: DefinicionRanura,
  campos: { label: string; valor: string }[] | undefined,
): Record<string, string> {
  if (!campos || campos.length === 0) return {}
  const slugPorLabel = new Map(ranura.campos.map(c => [c.label, c.slug]))
  const out: Record<string, string> = {}
  for (const c of campos) {
    const slug = slugPorLabel.get(c.label)
    if (!slug) continue
    const valor = (c.valor ?? '').replace(/\s*\(del viaje\)\s*$/i, '').trim()
    if (valor !== '') out[slug] = valor
  }
  return out
}
