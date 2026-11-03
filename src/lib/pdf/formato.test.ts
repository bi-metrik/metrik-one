import { describe, it, expect } from 'vitest'
import { fechaCorta, tarifaIva, fechaDeGeneracion } from './formato'

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
