/**
 * El margen que la propia captura ya fija, cuando muestra los DOS precios.
 *
 * Pedido de Alejandra y Daniela el 2026-09-16 (§4.4 de `propuesta-visual.md`): la
 * liquidación de Decameron trae **lo que paga el cliente**, **la comisión de la agencia**
 * y **lo que paga la agencia**. Con esos tres números el margen no es una decisión
 * comercial pendiente: ya está tomado por el proveedor, y el sistema tiene que
 * calcularlo solo.
 *
 * ## Qué estaba pasando sin esto
 *
 * `montoDeCosto` ya tomaba «total a pagar agencia» como COSTO (hallazgo 7.1: leído,
 * nunca recalculado). Pero el PRECIO seguía saliendo del margen de la cotización, así
 * que la línea se vendía a `costo / (1 - margen_de_la_cotización)` — un número que no
 * es el que el proveedor le va a cobrar al pasajero. Para cuadrarlo había que corregir
 * a mano, y la corrección que el equipo hacía (dejar el margen en 0) deja la línea a
 * costo y **dispara el gate de piso**, que es exactamente lo que el brief pide evitar.
 *
 * ## Por qué es un módulo puro y aparte
 *
 * `tarifa-pasajero.ts` responde «cuánto cuesta cada pasajero». Esta es otra pregunta —
 * «a cuánto se vende la línea» — y tiene un solo dato de entrada. Mezclarlas obligaría
 * a que el repartidor por tipo supiera de convenciones de margen.
 */

import type { ConvencionMargen } from './precio-item'

/**
 * Lo único que hace falta de una casilla leída. `LecturaCasilla` lo cumple por forma.
 *
 * Se declara aquí, y no se importa el tipo de `tarifa-pasajero.ts`, para que la
 * dependencia vaya en un solo sentido: ese módulo importa el resultado de éste.
 */
export interface LecturaConDosPrecios {
  /** El precio de la ocupación de la captura (lo que paga el cliente). */
  total: number
  /** «Total a pagar agencia», cuando la captura lo muestra aparte. */
  aPagarAgencia: number | null
  moneda: string
}

export interface MargenProveedor {
  /** Lo que la captura dice que paga el cliente, en la moneda de la captura. */
  precioCliente: number
  /** Lo que la captura dice que paga la agencia. Es el costo (hallazgo 7.1). */
  costoAgencia: number
  moneda: string
  /** Margen REAL sobre la venta, en porcentaje. */
  margenPct: number
}

/**
 * Diferencia mínima, en la moneda de la captura, para llamar comisión a la resta.
 *
 * Un peso de diferencia entre los dos números es redondeo del proveedor, no una
 * comisión: tomarlo como margen dejaría la línea en 0,00005% y **haría saltar el gate
 * de piso** por un error de lectura. Por encima de este piso la resta es un hecho de la
 * pantalla, aunque dé un margen bajo — y si da bajo, el gate tiene que saltar: ahí sí
 * está diciendo la verdad.
 */
const DIFERENCIA_MINIMA = 1

/**
 * El margen que fija la captura, o `null` si esa captura no lo fija.
 *
 * `null` es la respuesta normal y frecuente: un buscador de hoteles o el detalle de un
 * vuelo muestran UN precio, no dos. Ahí la línea sigue heredando el margen de la
 * cotización, que es el comportamiento de siempre.
 *
 * ⚠️ Un «total a pagar agencia» MAYOR que el precio al cliente devuelve `null`, no un
 * margen negativo. Puede pasar por una lectura cruzada de las dos casillas, y escribir
 * un margen negativo le pondría a la línea un precio por debajo del costo sin que nadie
 * lo pidiera. Que la resta no dé se ve al lado del número leído; un precio inventado no.
 */
export function margenDelProveedor(lectura: LecturaConDosPrecios | null | undefined): MargenProveedor | null {
  if (!lectura) return null
  const costoAgencia = lectura.aPagarAgencia
  const precioCliente = lectura.total
  if (costoAgencia === null || !Number.isFinite(costoAgencia) || costoAgencia <= 0) return null
  if (!Number.isFinite(precioCliente) || precioCliente <= 0) return null
  if (precioCliente - costoAgencia <= DIFERENCIA_MINIMA) return null

  return {
    precioCliente,
    costoAgencia,
    moneda: (lectura.moneda || 'COP').toUpperCase(),
    margenPct: ((precioCliente - costoAgencia) / precioCliente) * 100,
  }
}

/**
 * El número que va a `items.margen_porcentaje` para que el precio dé el del proveedor.
 *
 * ⚠️ Depende de la CONVENCIÓN de la cotización y no son el mismo número: con costo
 * 1.818.919 y precio 2.029.118, `sobre_venta` escribe 10,359 y `markup` escribe 11,556.
 * Escribir el de `sobre_venta` en una cotización `markup` vendería la línea en
 * 2.007.352 — 21.766 pesos por debajo de lo que el proveedor le cobra al pasajero.
 *
 * NO se redondea: `items.margen_porcentaje` es `numeric` sin escala (la migración
 * `20260903100000`), así que el precio que sale de `precioConMargen` reproduce el de la
 * captura al peso. Redondear a dos decimales lo movía ~20 pesos, que es poco dinero y
 * mucha pregunta.
 */
export function margenDeLineaSegunConvencion(
  m: MargenProveedor,
  convencion: ConvencionMargen,
): number {
  return convencion === 'sobre_venta'
    ? m.margenPct
    : (m.precioCliente / m.costoAgencia - 1) * 100
}
