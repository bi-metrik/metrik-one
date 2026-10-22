/**
 * UN TRASLADO POR CADA HOTEL (reunión con Trappvel del 2026-10-22, L1553-1611).
 *
 * «Deberíamos cotizar un traslado para cada hotel»: con varias opciones de hotel, el traslado del
 * aeropuerto al Hotel A no sirve para el Hotel B, y hasta hoy la asesora elegía a mano, tarifa por
 * tarifa, qué traslado iba con cada hotel (L1593). Ahora un traslado puede ir CON una opción de
 * hotel (`items.tarifa_pax.vaConHotel` = el id de esa opción, sin migración):
 *
 *  · cuenta solo en las tarifas que llevan ese hotel, y viaja con él en las tres tarifas y en el
 *    PDF (que imprime lo que suma cada tarifa);
 *  · un traslado SIN hotel es general («uno de Civitatis para la ciudad», L1611): sirve para
 *    cualquier opción de hotel, sin cargarlo tres veces.
 *
 * La regla vive en `itemsDelItinerario` (lo que suma cada tarifa), así que el total, el PDF, el
 * margen mínimo y la aprobación la siguen sin copiarla. Sin ninguna línea asociada, todo es
 * exactamente como antes.
 *
 * Puro.
 */

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** El hotel con que va la línea, leído del jsonb crudo. `null` = general. */
export function hotelDeLinea(item: { tarifa_pax?: unknown }): string | null {
  const t = item.tarifa_pax
  if (!esObj(t)) return null
  const h = t.vaConHotel
  return typeof h === 'string' && h.trim() ? h : null
}

/**
 * El hotel con que va cada línea, solo si ese hotel EXISTE en la cotización (y no es ella misma).
 * Una opción de hotel borrada deja el traslado como general: no se queda fuera de todo.
 */
export function hotelesAsociados(items: readonly { id: string; tarifa_pax?: unknown }[]): Map<string, string> {
  const ids = new Set(items.map(i => i.id))
  const m = new Map<string, string>()
  for (const i of items) {
    const h = hotelDeLinea(i)
    if (h && h !== i.id && ids.has(h)) m.set(i.id, h)
  }
  return m
}

/** ¿Esta línea puede contar donde van estos hoteles? La general, siempre. */
export function cabeConLosHoteles(id: string, asociados: ReadonlyMap<string, string>, incluidos: ReadonlySet<string>): boolean {
  const h = asociados.get(id)
  return !h || incluidos.has(h)
}

/**
 * La opción que va con los hoteles de una tarifa: la de su hotel; si no hay, la general; si
 * tampoco, `null`. En el orden de los candidatos (la primera que se pegó gana el empate).
 */
export function opcionParaLosHoteles(
  candidatos: readonly string[],
  asociados: ReadonlyMap<string, string>,
  incluidos: ReadonlySet<string>,
): string | null {
  const suya = candidatos.find(id => {
    const h = asociados.get(id)
    return !!h && incluidos.has(h)
  })
  if (suya) return suya
  return candidatos.find(id => !asociados.has(id)) ?? null
}
