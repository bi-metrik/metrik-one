import { describe, it, expect } from 'vitest'
import { parseMontoCop, montosCoinciden } from './monto-cop'

describe('parseMontoCop — separador de miles vs decimal', () => {
  // El caso que motivó el módulo: el mismo carácter con dos significados.
  it('el punto de miles NO multiplica el valor', () => {
    expect(parseMontoCop('$ 701.812')).toBe(701812)
    expect(parseMontoCop('701.812')).toBe(701812)
    expect(parseMontoCop('1.234.567')).toBe(1234567)
  })

  // Real: las tarifas derivadas del cobro el 2026-07-29 quedaron con decimales.
  // Con `replace(/[^\d]/g,'')` esto daba 35090600 — cien veces más.
  it('el punto decimal NO se pega a la parte entera', () => {
    expect(parseMontoCop('350906.00')).toBe(350906)
    expect(parseMontoCop('773316.5')).toBe(773316.5)
  })

  it('formato con ambos separadores: manda el último', () => {
    expect(parseMontoCop('1.234.567,89')).toBeCloseTo(1234567.89, 2)
    expect(parseMontoCop('1,234,567.89')).toBeCloseTo(1234567.89, 2)
  })

  it('coma decimal sola', () => {
    expect(parseMontoCop('1234,5')).toBeCloseTo(1234.5, 2)
  })

  // Ambiguo de verdad. Se resuelve como miles: en COP no hay decimales de 3 dígitos.
  it('tres dígitos tras el separador se leen como miles', () => {
    expect(parseMontoCop('1.234')).toBe(1234)
  })

  it('limpia símbolos, texto y espacios', () => {
    expect(parseMontoCop('  $701.812 COP ')).toBe(701812)
    expect(parseMontoCop('COP$ 850.000')).toBe(850000)
  })

  it('acepta números tal cual', () => {
    expect(parseMontoCop(701812)).toBe(701812)
    expect(parseMontoCop(0)).toBe(0)
  })

  it('negativos', () => {
    expect(parseMontoCop('-701.812')).toBe(-701812)
    expect(parseMontoCop('(701.812)')).toBe(-701812)
  })

  // null, no 0: un monto ilegible no es un monto de cero.
  it('devuelve null cuando no hay monto legible', () => {
    expect(parseMontoCop('')).toBeNull()
    expect(parseMontoCop('   ')).toBeNull()
    expect(parseMontoCop(null)).toBeNull()
    expect(parseMontoCop(undefined)).toBeNull()
    expect(parseMontoCop('sin valor')).toBeNull()
    expect(parseMontoCop('$')).toBeNull()
  })
})

describe('montosCoinciden — tolerancia de materialidad', () => {
  // Casos reales de SOENA, ambos legítimos y ambos distintos al peso.
  it('V0253: $248 de diferencia entra en tolerancia', () => {
    expect(montosCoinciden(773316, '$ 773.564', 1000)).toBe(true)
  })

  it('V0049: $1.812 de diferencia NO entra en tolerancia', () => {
    expect(montosCoinciden(701812, '$ 700.000', 1000)).toBe(false)
  })

  it('el límite es inclusivo', () => {
    expect(montosCoinciden(100000, 101000, 1000)).toBe(true)
    expect(montosCoinciden(100000, 101001, 1000)).toBe(false)
  })

  it('compara valor, no forma de escribirlo', () => {
    expect(montosCoinciden('350906.00', '$ 350.906', 0)).toBe(true)
  })

  // Sin uno de los lados no se puede afirmar que coinciden.
  it('un lado ausente no pasa el check', () => {
    expect(montosCoinciden(701812, '', 1000)).toBe(false)
    expect(montosCoinciden(null, 701812, 1000)).toBe(false)
  })

  it('tolerancia inválida se trata como cero', () => {
    expect(montosCoinciden(100000, 100001, Number.NaN)).toBe(false)
    expect(montosCoinciden(100000, 100000, Number.NaN)).toBe(true)
  })
})
