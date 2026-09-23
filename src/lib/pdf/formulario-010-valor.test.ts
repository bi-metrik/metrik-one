import { describe, it, expect } from 'vitest'
import { formatCurrency } from './formulario-010'

// Casilla 56 del 010 (valor solicitado). Con `Number(v.replace(/[^\d.-]/g, ''))` el
// punto de miles se leía como decimal y la casilla imprimía «351» en vez de «350.906».
describe('formulario 010 — valor solicitado', () => {
  it('el punto de miles se lee como miles', () => {
    expect(formatCurrency('350.906')).toBe('350.906') //           antes: «351»
    expect(formatCurrency('$ 350.906')).toBe('350.906') //         antes: «351»
    expect(formatCurrency('350.906,50')).toBe('350.907') //        antes: «351»
  })

  it('miles con punto y decimales con coma', () => {
    expect(formatCurrency('$ 1.234.567,89')).toBe('1.234.568') //  antes: el texto crudo
  })

  // CONTROL: lo que ya se leía bien no cambia.
  it('el valor sin separadores sale igual que antes', () => {
    expect(formatCurrency('350906')).toBe('350.906')
    expect(formatCurrency('350906.00')).toBe('350.906')
    expect(formatCurrency('5439880')).toBe('5.439.880')
  })

  it('sin monto legible devuelve el texto tal cual, y vacío es null', () => {
    expect(formatCurrency('ver anexo')).toBe('ver anexo')
    expect(formatCurrency('')).toBeNull()
    expect(formatCurrency(null)).toBeNull()
  })
})
