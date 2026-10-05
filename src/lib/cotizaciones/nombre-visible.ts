/**
 * El nombre con que se MUESTRA una opción de hotel o de traslado: en su tarjeta, en «Así lo ve
 * el cliente» y en la «Inversión» del documento (brief del 2026-10-01, punto 4).
 *
 * Trappvel guarda el nombre de la línea en mayúscula (`aMayusculas` al confirmar la lectura).
 * El hotel se veía como se escribió porque su tarjeta y su ficha salen de la lectura («PRUEBA
 * Posada del Mar»), y el traslado salía en MAYÚSCULAS porque su tarjeta y su línea pintan
 * `items.nombre` («AEROPUERTO - HOTEL (IDA Y REGRESO)»). Mismo tratamiento para los dos: si el
 * nombre de la línea es justo el que ONE escribió desde la lectura, se muestra el de la lectura,
 * con sus mayúsculas y minúsculas. Un nombre que escribió una persona se respeta tal cual.
 *
 * Desde el brief del 2026-10-05 (punto 10) también el vuelo y la actividad: «SATENA BOGOTÁ
 * (BOG)–PROVIDENCIA (PVA)» y «EXCURSIÓN A CAYO CANGREJO» salían así en «Inversión» del PDF, en el
 * título de la tarjeta y en los avisos de «Revisar y enviar». Las líneas sin ranura no cambian. No
 * se toca lo guardado: es presentación.
 *
 * Puro: sin red y sin base.
 */

import { aMayusculas } from '@/lib/negocios/mayusculas'
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { leerTarifaPax } from './tarifa-pasajero'

const RANURAS_CON_NOMBRE_LEIDO = new Set(['hotel_detalle', 'traslado_detalle', 'vuelo_detalle', 'actividad_detalle'])

export function nombreVisibleDeLinea(item: { nombre?: string | null; grupo?: string | null; tarifa_pax?: unknown }): string {
  // Sin ranura de viaje, el nombre llega idéntico (el PDF de las otras plantillas no cambia).
  const tal = item.nombre ?? ''
  const nombre = tal.trim()
  const slug = ranuraDeGrupo(item.grupo ?? null)?.slug
  if (!nombre || !slug || !RANURAS_CON_NOMBRE_LEIDO.has(slug)) return tal
  const t = leerTarifaPax(item.tarifa_pax)
  const leido = (t.casillas?.grupo_completo?.nombre ?? t.habitaciones?.[0]?.lectura.nombre ?? '').trim()
  return leido && nombre === aMayusculas(leido) ? leido : tal
}
