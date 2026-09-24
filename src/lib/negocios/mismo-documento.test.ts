/**
 * `mismoDocumento`: el criterio con que un cruce decide que dos papeles hablan de la misma
 * persona. Los casos son de SOENA, medidos en producción el 2026-09-24 (RUT contra los
 * compradores leídos de la factura).
 */
import { describe, expect, it } from 'vitest'
import { mismoDocumento } from './fuentes-negocio'

describe('mismoDocumento', () => {
  it('igual, con puntos, o con el dígito de verificación pegado', () => {
    expect(mismoDocumento('1.032.426.193', '1032426193')).toBe(true)
    expect(mismoDocumento('9010452190', '901045219')).toBe(true)
  })

  it('RUT con el código «13» (cédula) de la DIAN pegado delante', () => {
    expect(mismoDocumento('137556326', '7556326')).toBe(true) // V0395
    expect(mismoDocumento('1379907467', '79907467')).toBe(true) // V0254
    expect(mismoDocumento('1379485203', '79485203')).toBe(true) // V0110
    // Simétrico: da igual qué lado trae el prefijo.
    expect(mismoDocumento('79485203', '1379485203')).toBe(true)
  })

  it('RUT con solo el «1» pegado delante', () => {
    expect(mismoDocumento('132747706', '32747706')).toBe(true) // V0177
  })

  it('un dígito distinto sigue siendo otro documento (V0142: el RUT está mal leído)', () => {
    expect(mismoDocumento('1022424289', '1022424269')).toBe(false)
    expect(mismoDocumento('1022424269', '1022424289')).toBe(false)
  })

  it('el prefijo exige igualdad exacta: no se combina con la tolerancia del DV', () => {
    // 1122456789 sin el «1» empieza por 12245678, pero son dos cédulas distintas.
    expect(mismoDocumento('1122456789', '12245678')).toBe(false)
    // 13 + X + un dígito más tampoco.
    expect(mismoDocumento('1375563261', '7556326')).toBe(false)
  })

  it('una cédula de 10 dígitos (10xxxxxxxx) no es «1» + otra que empieza por 0', () => {
    expect(mismoDocumento('1032445129', '032445129')).toBe(false)
  })

  it('el resto necesita al menos 6 dígitos', () => {
    expect(mismoDocumento('1312345', '12345')).toBe(false)
    expect(mismoDocumento('13123456', '123456')).toBe(true)
  })

  it('otro prefijo cualquiera no cuenta', () => {
    expect(mismoDocumento('2379907467', '79907467')).toBe(false)
    expect(mismoDocumento('1479907467', '79907467')).toBe(false)
  })
})
