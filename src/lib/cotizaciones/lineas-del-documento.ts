/**
 * Qué líneas de una cotización cuenta y describe el documento del cliente.
 *
 * Vive aquí, y no dentro de la acción del PDF, porque la usan DOS caminos que tienen que
 * ver las mismas líneas: la acción que genera el PDF y el redactor del texto para el
 * cliente (`documento-cliente-datos.ts`). Escrita dos veces, el texto describiría un vuelo
 * que el documento no imprime.
 */

import { itemsQueAportanAlTotal } from './itinerarios'

export interface LineaDelDocumento {
  id?: string
  grupo?: string | null
  opcion_de?: string | null
  es_ajuste?: boolean | null
  orden?: number | null
  dia_relativo?: number | null
  entra_al_precio?: boolean | null
}

/**
 * R-A1 · qué líneas aportan al total cuando no hay itinerario principal.
 *
 * Una ranura con dos vuelos imprimía las DOS líneas al cliente y sumaba las dos en el
 * Subtotal, contra un TOTAL que salía de `valor_total`. Es el MISMO helper que usa
 * `recalcularTotales` para escribir `valor_total`, así que el documento no puede
 * discrepar con la pantalla. Sin ranuras con alternativas devuelve todos los ítems.
 *
 * Una sugerencia FUERA DEL PRECIO no aporta. El ítem de cuadre entra siempre: su rama vive
 * fuera de las ranuras.
 */
export function aportaAlTotal<T extends LineaDelDocumento>(items: T[]): (i: T) => boolean {
  const aportan = new Set(
    itemsQueAportanAlTotal(
      items.filter(i => i.id).map(i => ({
        id: i.id as string,
        grupo: i.grupo ?? null,
        opcion_de: i.opcion_de ?? null,
        es_ajuste: i.es_ajuste ?? false,
        orden: i.orden ?? 0,
        dia_relativo: i.dia_relativo ?? null,
        entra_al_precio: i.entra_al_precio ?? null,
      })),
    ),
  )
  return (i: T) => !i.id || aportan.has(i.id) || i.es_ajuste === true
}

/**
 * Las líneas que el documento DESCRIBE: con itinerario principal, las suyas (en su orden);
 * sin él, las que aportan al total. Describir una alternativa descartada pondría en el
 * documento un vuelo que el cliente no está comprando.
 */
export function lineasQueDescribeElDocumento<T extends LineaDelDocumento>(
  items: T[],
  idsDelPrincipal: string[] | null,
  aporta: (i: T) => boolean = aportaAlTotal(items),
): T[] {
  if (idsDelPrincipal) {
    const porId = new Map(items.filter(i => i.id).map(i => [i.id as string, i]))
    return idsDelPrincipal.map(id => porId.get(id)).filter((i): i is T => i !== undefined)
  }
  return items.filter(aporta)
}
