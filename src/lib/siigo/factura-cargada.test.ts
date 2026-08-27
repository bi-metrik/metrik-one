import { describe, it, expect } from 'vitest'
import { numeroFacturaEnData } from './factura-cargada'

describe('numeroFacturaEnData', () => {
  it('sin instancia del bloque no hay factura cargada', () => {
    expect(numeroFacturaEnData(null)).toBeNull()
    expect(numeroFacturaEnData(undefined)).toBeNull()
  })

  it('el bloque creado pero vacío tampoco cuenta', () => {
    expect(numeroFacturaEnData({})).toBeNull()
    expect(numeroFacturaEnData({ campos: {} })).toBeNull()
  })

  it('un campo en blanco no es un consecutivo', () => {
    // La extracción deja la llave puesta aunque no encuentre el dato: leerla como
    // "sí hay factura" bloquearía la emisión de un negocio sin facturar.
    expect(numeroFacturaEnData({ campos: { numero_factura: { value: '' } } })).toBeNull()
    expect(numeroFacturaEnData({ campos: { numero_factura: { value: '   ' } } })).toBeNull()
    expect(numeroFacturaEnData({ campos: { numero_factura: { value: null } } })).toBeNull()
  })

  it('devuelve el consecutivo que cargó una persona', () => {
    // Forma que deja la extracción con IA de un PDF subido a mano.
    const data = { campos: { numero_factura: { value: 'FV-2-198', confidence: 0.97 } } }
    expect(numeroFacturaEnData(data)).toBe('FV-2-198')
  })

  it('devuelve el consecutivo que dejó la emisión desde ONE', () => {
    // `archivarPdfEnBloque` escribe `{value, manual: true}`.
    const data = { campos: { numero_factura: { value: ' FV-2-244 ', manual: true } } }
    expect(numeroFacturaEnData(data)).toBe('FV-2-244')
  })

  it('un consecutivo sin prefijo, guardado como número, sigue contando', () => {
    expect(numeroFacturaEnData({ campos: { numero_factura: { value: 244 } } })).toBe('244')
  })

  it('ignora los demás campos del bloque', () => {
    const data = { campos: { valor_total: { value: 637500 }, emisor_nit: { value: '900123456' } } }
    expect(numeroFacturaEnData(data)).toBeNull()
  })
})
