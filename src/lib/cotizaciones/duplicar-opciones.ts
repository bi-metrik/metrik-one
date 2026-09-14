/**
 * Duplicar una cotización que tiene opciones e itinerarios.
 *
 * ## Por qué esto vive aparte y con pruebas
 *
 * `items.opcion_de` es una **FK a la propia tabla**, y `itinerario_opciones.item_id`
 * apunta a los ítems. Al copiar, los ids cambian: si el remapeo se hace mal, la copia
 * queda apuntando a los ítems del ORIGINAL. Eso no falla —las filas existen— y el
 * síntoma es que editar la copia le mueve las combinaciones a la cotización de la que
 * salió. Es exactamente la familia de defectos que ya costó caro en esta misma
 * función: `margen_porcentaje ?? 0` convirtió «hereda» en «excepción al 0%» y la copia
 * entera salió vendida a costo.
 *
 * `duplicarCotizacion` es además la vía por la que un defecto de copia llega a
 * cotizaciones cerradas, así que el remapeo se prueba solo, sin base.
 */

/** Lo mínimo de un ítem original para saber a qué apunta. */
export interface ItemOriginal {
  id: string
  opcion_de?: string | null
}

/** Lo mínimo de un itinerario original para copiarlo. */
export interface ItinerarioOriginal {
  id: string
  nombre: string | null
  orden: number
  va_en_propuesta: boolean
  es_principal: boolean
  seleccion: string[]
}

/**
 * Qué `opcion_de` le toca a cada ítem NUEVO, traducido al mundo de la copia.
 *
 * Devuelve solo los que apuntan a alguien: un ítem titular no necesita un UPDATE.
 *
 * ⚠️ Un `opcion_de` que apunta a un ítem que NO se copió se traduce a `null`, no se
 * conserva. Dejar el id viejo haría que la copia colgara de un ítem de la cotización
 * original: el ítem quedaría vivo en la copia pero su ranura la decidiría otro
 * documento. Perder el vínculo es visible —la opción aparece como titular suelto— y
 * conservarlo mal no lo es.
 */
export function remapearOpcionDe(
  originales: ItemOriginal[],
  mapa: Map<string, string>,
): { nuevoId: string; opcionDe: string | null }[] {
  const patches: { nuevoId: string; opcionDe: string | null }[] = []
  for (const item of originales) {
    if (!item.opcion_de) continue
    const nuevoId = mapa.get(item.id)
    if (!nuevoId) continue
    patches.push({ nuevoId, opcionDe: mapa.get(item.opcion_de) ?? null })
  }
  return patches
}

/**
 * Los itinerarios de la copia, con su selección ya traducida.
 *
 * ⚠️ Un itinerario cuya selección quede **incompleta** porque alguno de sus ítems no
 * se copió se conserva igual, con lo que sí se pudo traducir. La regla R2 lo marcará
 * incompleto en pantalla y nadie podrá mandarlo al cliente, que es el desenlace
 * correcto: borrarlo en silencio le quitaría a alguien una combinación que armó.
 */
export function itinerariosParaLaCopia(
  originales: ItinerarioOriginal[],
  mapaItems: Map<string, string>,
  nuevaCotizacionId: string,
  workspaceId: string,
): { cabecera: Record<string, unknown>; seleccion: string[]; origenId: string }[] {
  return originales.map(orig => ({
    origenId: orig.id,
    cabecera: {
      workspace_id: workspaceId,
      cotizacion_id: nuevaCotizacionId,
      nombre: orig.nombre,
      orden: orig.orden,
      // ⚠️ La marca de propuesta SÍ se hereda, y el principal TAMBIÉN: duplicar es
      // corregir el mismo documento, y una copia que naciera con todo apagado
      // obligaría a rehacer la revisión de nueve combinaciones. El candado del piso
      // se vuelve a aplicar en el primer `recalcularTotales` de la copia, así que una
      // combinación que dejó de valer se desmarca sola y lo dice.
      va_en_propuesta: orig.va_en_propuesta,
      es_principal: orig.es_principal,
    },
    seleccion: orig.seleccion
      .map(id => mapaItems.get(id))
      .filter((id): id is string => typeof id === 'string'),
  }))
}
