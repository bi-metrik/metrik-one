/**
 * El precio de una línea que se vende POR PASAJERO cuadra con lo que paga cada pasajero
 * (brief del 2026-10-05, punto 11).
 *
 * ## El defecto
 *
 * El traslado de COT-2026-0020 costaba 180.000 para 2 adultos y 1 infante (gratis). Con el
 * margen, la línea valía 211.764,7 → 211.765. «Así lo ve el cliente» y el PDF reparten ese
 * precio entre los adultos y lo redondean al peso: 105.883 cada uno. Y 105.883 × 2 = 211.766,
 * un peso más que el total. El cliente suma la columna; la cotización no cuadraba consigo misma.
 *
 * ## La regla
 *
 * *Ficha = vista del cliente = PDF = total.* El precio por pasajero es la cifra que la agencia
 * le dice al cliente, así que es la que manda: el precio de la línea es la SUMA de los precios
 * por pasajero ya redondeados (105.882 × 2 = 211.764), no al revés. Es la misma idea con que
 * la cascada ya cuadra el precio al peso POR UNIDAD (`calcularCascada`).
 *
 * Se reparte exactamente como reparte la pantalla (`precioPorPasajero`): en proporción al costo
 * de cada tipo, con `repartirProporcional`, y al peso por pasajero. Se itera hasta que repartir
 * el precio cuadrado da otra vez el mismo precio (casi siempre a la primera); si no se estabiliza
 * en tres vueltas, el precio queda como estaba y el documento absorbe el redondeo como antes.
 *
 * ⚠️ Solo con la confirmación vigente (el costo de la línea sigue siendo el confirmado) y sin
 * precios escritos a mano en la tarjeta: con ellos el reparto es otro (`repartirConManuales`).
 * Una línea sin tarifa por pasajero —todo lo que no es Trappvel— no trae filas y no cambia.
 */

import { confirmadaVigente, leerTarifaPax, repartirProporcional } from './tarifa-pasajero'

export interface FilaDePasajeros {
  cantidad: number
  /** El costo del tipo: es el peso con que se reparte el precio. */
  peso: number
}

/**
 * Los tipos de pasajero entre los que se reparte el precio de la línea, o `null` si la línea no
 * se vende por pasajero (o su confirmación ya no describe su costo).
 *
 * @param costoUnitarioDeLinea La suma de los rubros confirmados (el costo de UNA unidad).
 */
export function pasajerosParaCuadre(tarifaPax: unknown, costoUnitarioDeLinea: number): FilaDePasajeros[] | null {
  if (!tarifaPax) return null
  const t = leerTarifaPax(tarifaPax)
  const c = t.confirmada
  if (!c || c.costos.length === 0) return null
  if (t.preciosAMano && Object.keys(t.preciosAMano).length > 0) return null
  if (!confirmadaVigente(c, costoUnitarioDeLinea)) return null
  const filas = c.costos.filter(x => x.cantidad > 0).map(x => ({ cantidad: x.cantidad, peso: Number(x.totalCOP) || 0 }))
  if (filas.length === 0 || filas.every(f => f.peso <= 0)) return null
  return filas
}

/** Lo que pagan los pasajeros de una unidad de la línea, repartiendo `precio` como la pantalla. */
function sumaPorPasajero(precio: number, filas: readonly FilaDePasajeros[]): number {
  const repartido = repartirProporcional(precio, filas.map(f => f.peso))
  return filas.reduce((a, f, i) => a + Math.round(repartido[i] / f.cantidad) * f.cantidad, 0)
}

/**
 * El precio de UNA unidad de la línea, cuadrado para que la suma de los precios por pasajero
 * (redondeados al peso) sea exactamente él. `precio` puede traer decimales (sale del margen).
 */
export function precioCuadradoPorPasajero(precio: number, filas: readonly FilaDePasajeros[] | null | undefined): number {
  if (!filas || filas.length === 0 || !(precio > 0)) return precio
  let actual = sumaPorPasajero(precio, filas)
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const siguiente = sumaPorPasajero(actual, filas)
    if (siguiente === actual) return actual
    actual = siguiente
  }
  return precio
}
