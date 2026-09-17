/**
 * El margen que el pantallazo ya fija, con los números REALES de la liquidación de
 * Decameron del banco del 2026-09-16 (`capturas-proveedor/2026-09-16/3.57.39_PM.jpeg`).
 *
 * De la pantalla: ADULTOS 2 × $2.019.412 e INFANTES 1 × $9.706, Sub-Total $2.029.118,
 * COMISIÓN 9,23% ($187.288), PRESTACIÓN 0,77% ($15.624), **TOTAL A PAGAR AGENCIA
 * $1.818.919** y **TOTAL A PAGAR PAX $2.029.118**.
 *
 * ⚠️ El costo es el número LEÍDO, nunca el recalculado: 2.029.118 − 187.288 − 15.624 =
 * 1.826.206, y la pantalla dice 1.818.919. Faltan 7.287 sin concepto visible (hallazgo 7.1
 * del diseño, D4 abierta). Por eso el margen sale de los dos totales y no de la comisión.
 */
import { describe, expect, it } from 'vitest'

import { margenDelProveedor, margenDeLineaSegunConvencion } from './margen-proveedor'
import { precioConMargen } from './precio-item'

const DECAMERON = { total: 2_029_118, aPagarAgencia: 1_818_919, moneda: 'COP' }

describe('el margen sale de los dos precios de la captura', () => {
  it('Decameron: 10,36% sobre la venta, con los dos números a la vista', () => {
    const m = margenDelProveedor(DECAMERON)
    expect(m).not.toBeNull()
    expect(m?.precioCliente).toBe(2_029_118)
    expect(m?.costoAgencia).toBe(1_818_919)
    expect(m?.margenPct).toBeCloseTo(10.359, 3)
  })

  it('es la razón entre dos números de la MISMA captura: no depende de la moneda', () => {
    const enUsd = margenDelProveedor({ total: 1000, aPagarAgencia: 896.41, moneda: 'usd' })
    expect(enUsd?.margenPct).toBeCloseTo(10.359, 2)
    expect(enUsd?.moneda).toBe('USD')
  })

  it('sin «total a pagar agencia» no hay margen que fijar: la línea hereda el de la cotización', () => {
    expect(margenDelProveedor({ total: 2_029_118, aPagarAgencia: null, moneda: 'COP' })).toBeNull()
  })

  // Un peso de diferencia es redondeo del proveedor. Tomarlo como comisión dejaría la
  // línea al 0,00005% y haría saltar el gate de piso por un error de lectura.
  it('una diferencia de un peso NO es una comisión', () => {
    expect(margenDelProveedor({ total: 2_029_118, aPagarAgencia: 2_029_117, moneda: 'COP' })).toBeNull()
  })

  it('un costo MAYOR que el precio devuelve null, nunca un margen negativo', () => {
    expect(margenDelProveedor({ total: 1_818_919, aPagarAgencia: 2_029_118, moneda: 'COP' })).toBeNull()
  })

  it('una captura sin precio no fija nada', () => {
    expect(margenDelProveedor({ total: 0, aPagarAgencia: 1_000, moneda: 'COP' })).toBeNull()
    expect(margenDelProveedor(null)).toBeNull()
    expect(margenDelProveedor(undefined)).toBeNull()
  })
})

/**
 * Lo que sostiene todo: el número escrito en `items.margen_porcentaje` tiene que devolver
 * EXACTAMENTE el precio de la captura cuando `recalcularTotales` lo aplique. Se comprueba
 * con `precioConMargen`, la misma función de la cascada, no con una fórmula copiada aquí.
 */
describe('el margen escrito reproduce el precio del proveedor, al peso', () => {
  const m = margenDelProveedor(DECAMERON)!

  it('con la convención «sobre_venta» (la de las cotizaciones nuevas)', () => {
    const pct = margenDeLineaSegunConvencion(m, 'sobre_venta')
    expect(pct).toBeCloseTo(10.359, 3)
    expect(Math.round(precioConMargen(1_818_919, pct, 'sobre_venta'))).toBe(2_029_118)
  })

  it('con la convención «markup» (la de lo cotizado antes) el número es OTRO', () => {
    const pct = margenDeLineaSegunConvencion(m, 'markup')
    expect(pct).toBeCloseTo(11.556, 3)
    expect(Math.round(precioConMargen(1_818_919, pct, 'markup'))).toBe(2_029_118)
  })

  // La confusión que esto evita: escribir el porcentaje de `sobre_venta` en una
  // cotización `markup` vende la línea 21.775 pesos por debajo de lo que el proveedor
  // le cobra al pasajero, y nada en pantalla lo delata.
  it('cruzar las convenciones cambia el precio, y por eso la conversión existe', () => {
    const deVenta = margenDeLineaSegunConvencion(m, 'sobre_venta')
    expect(Math.round(precioConMargen(1_818_919, deVenta, 'markup'))).toBe(2_007_343)
  })
})
