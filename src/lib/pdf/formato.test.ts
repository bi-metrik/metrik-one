import { describe, it, expect } from 'vitest'
import { fmtAlMil, redondearAlMil, fechaCorta, tarifaIva, fechaDeGeneracion } from './formato'

/** El separador que mete Intl entre `$` y la cifra es un espacio DURO (U+00A0). */
const pesos = (cifra: string) => `$ ${cifra}`

describe('IVA aproximado al mil (art. 577 ET)', () => {
  it('redondea al múltiplo de mil más cercano', () => {
    expect(fmtAlMil('1234499')).toBe(pesos('1.234.000'))
    expect(fmtAlMil('1234500')).toBe(pesos('1.235.000'))
    expect(fmtAlMil('16412381')).toBe(pesos('16.412.000'))
    expect(redondearAlMil('999')).toBe(1000)
  })

  it('sin valor devuelve el marcador', () => {
    expect(fmtAlMil(null)).toBe('—')
    expect(fmtAlMil(null, '[IVA SOLICITADO]')).toBe('[IVA SOLICITADO]')
    expect(redondearAlMil(null)).toBeNull()
  })

  it('un texto no numérico sale tal cual, nunca "NaN"', () => {
    expect(fmtAlMil('16.412.381,00')).toBe('16.412.381,00')
  })
})

describe('fecha corta DD/MM/AAAA', () => {
  it('no se corre de día por zona horaria', () => {
    expect(fechaCorta('2026-03-05')).toBe('05/03/2026')
    expect(fechaCorta('2026-01-01T00:00:00Z')).toBe('01/01/2026')
  })

  it('sin valor, marcador; sin ISO, tal cual', () => {
    expect(fechaCorta(null)).toBe('—')
    expect(fechaCorta('5 de marzo')).toBe('5 de marzo')
  })
})

describe('tarifa de IVA derivada', () => {
  it('redondea a entero porcentual', () => {
    expect(tarifaIva('4319048', '86380952')).toBe('5 %')
    expect(tarifaIva('16412381', '86380952')).toBe('19 %')
  })

  it('sin dato calculable no inventa', () => {
    expect(tarifaIva(null, '86380952')).toBe('—')
    expect(tarifaIva('100', '0')).toBe('—')
    expect(tarifaIva('abc', '100', '[TARIFA]')).toBe('[TARIFA]')
  })
})

describe('fecha de generación en Bogotá', () => {
  it('después de las 7 p. m. de Bogotá sigue siendo el mismo día', () => {
    // 2026-10-29 21:30 en Bogotá = 2026-10-30 02:30 UTC.
    expect(fechaDeGeneracion('2026-10-30T02:30:00.000Z')).toEqual({ dia: 29, mes: 'octubre', anio: 2026 })
  })

  it('una fecha sola no retrocede', () => {
    expect(fechaDeGeneracion('2026-09-07')).toEqual({ dia: 7, mes: 'septiembre', anio: 2026 })
  })
})
