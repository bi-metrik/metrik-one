/**
 * QA G11 (2026-10-30): «Cerrado 29 oct» tomaba la fecha del comprobante del anticipo, anterior a la
 * confirmación del cliente (30 oct). VISTO FALLAR sobre main: no existía la regla y la ficha pintaba
 * la fecha del primer cobro.
 */
import { describe, expect, it } from 'vitest'
import { fechaDeCierreDeVenta } from './fecha-cierre-venta'

describe('la fecha de «Cerrado» en la ficha', () => {
  it('con la confirmación del cliente registrada, es la de la confirmación', () => {
    expect(fechaDeCierreDeVenta('2026-10-29', { confirmacion_cliente: { fecha: '2026-10-30', registrada_at: '2026-10-30T19:18:00Z' } })).toBe('2026-10-30')
  })

  it('sin confirmación (SOENA, AFI…), la del primer cobro, como siempre', () => {
    expect(fechaDeCierreDeVenta('2026-10-29', {})).toBe('2026-10-29')
    expect(fechaDeCierreDeVenta('2026-10-29', null)).toBe('2026-10-29')
    expect(fechaDeCierreDeVenta(null, { confirmacion_cliente: { fecha: 'ayer' } })).toBeNull()
  })
})
