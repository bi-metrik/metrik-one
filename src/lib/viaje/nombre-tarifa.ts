/**
 * El nombre de la tarifa que el cliente escogió, para el mensaje de confirmación y el panel de
 * Confirmación (QA de Trappvel G14, 2026-11-03).
 *
 * Con la opción 2 sin nombre propio (`cotizacion_itinerarios.nombre` en null) la hoja le ponía
 * «Tarifa» de relleno, y el cliente recibía «*Tarifa:* Tarifa» y el panel decía «Tarifa Tarifa ·
 * $9.280.000». Ahora: el nombre propio si dice algo; si no, el hotel del paquete de esa tarifa (cada
 * paquete de bloqueo es una tarifa, D5); si tampoco, `null` y la línea no sale.
 *
 * Puro y liviano (lo importan `confirmacion.ts` y el panel): lee el paquete como `paqueteDelItem`
 * sin cargar `servicios-desde-tarifa`.
 */

import { leerPaqueteBloqueo } from '@/lib/cotizaciones/bloqueo-paquete'
import { leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'

function hotelDelPaquete(item: { tarifa_pax?: unknown }): string | null {
  if (item.tarifa_pax === null || item.tarifa_pax === undefined) return null
  try {
    return leerPaqueteBloqueo(leerTarifaPax(item.tarifa_pax).bloqueo)?.hotel.hotel?.trim() || null
  } catch {
    return null
  }
}

/** «Tarifa», «Opción 2», «Tarifa 3»: rellenos que no le dicen nada al cliente. */
export function esNombreGenerico(nombre: string | null | undefined): boolean {
  const n = (nombre ?? '').trim()
  return n === '' || /^(tarifa|opci[oó]n)(\s*\d+)?$/i.test(n)
}

export interface ItemParaNombre {
  id: string
  tarifa_pax?: unknown
  es_ajuste?: boolean | null
}

/**
 * El nombre que dice algo de la tarifa: el propio, o los hoteles de sus paquetes, o `null`.
 *
 * @param seleccion Las líneas de la tarifa (`itinerario_opciones`); `null` = toda la cotización.
 */
export function nombreUtilDeTarifa(
  nombre: string | null | undefined,
  items: readonly ItemParaNombre[],
  seleccion: readonly string[] | null,
): string | null {
  if (!esNombreGenerico(nombre)) return (nombre as string).trim()
  const dentro = seleccion ? new Set(seleccion) : null
  const hoteles: string[] = []
  for (const i of items) {
    if (i.es_ajuste === true || (dentro && !dentro.has(i.id))) continue
    const hotel = hotelDelPaquete(i)
    if (hotel && !hoteles.includes(hotel)) hoteles.push(hotel)
  }
  return hoteles.length > 0 ? hoteles.join(' + ') : null
}

/**
 * La línea del panel de Confirmación: «Tarifa GHL Relax»; si el nombre ya empieza por «Tarifa», tal
 * cual; un relleno o nada, `null` (el panel dice «Total»).
 */
export function lineaDeTarifaEnPanel(nombre: string | null | undefined): string | null {
  if (esNombreGenerico(nombre)) return null
  const n = (nombre as string).trim()
  return /^tarifa\b/i.test(n) ? n : `Tarifa ${n}`
}
