import { describe, it, expect } from 'vitest'
import { normalizarMontoExtraido } from './monto-extraido'

/**
 * La regla de `extract-fields.ts` ANTES de este cambio, copiada tal cual. Es el
 * patrón contra el que se mide que solo cambie lo que debía cambiar.
 */
function anterior(value: string): string {
  let cleaned = value.replace(/[$\s]/g, '')
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else if ((cleaned.match(/\./g) || []).length > 1) {
    cleaned = cleaned.replace(/\./g, '')
  } else if (cleaned.includes('.')) {
    const afterDot = cleaned.split('.')[1]
    if (afterDot && afterDot.length === 3) {
      cleaned = cleaned.replace('.', '')
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.')
  }
  const num = parseFloat(cleaned)
  return isNaN(num) ? value : String(Math.round(num))
}

// [entrada, antes, ahora]. Las filas donde antes ≠ ahora son las únicas que cambian.
const TABLA: Array<[string, string, string]> = [
  // Lo que el prompt pide y el modelo casi siempre devuelve.
  ['1500000', '1500000', '1500000'],
  ['0', '0', '0'],
  // Formato colombiano.
  ['$ 1.500.000', '1500000', '1500000'],
  ['1.500.000,00', '1500000', '1500000'],
  ['$ 1.234.567,89', '1234568', '1234568'],
  ['350.906', '350906', '350906'],
  ['1.500', '1500', '1500'],
  ['1500,50', '1501', '1501'],
  ['12,5', '13', '13'],
  ['0,19', '0', '0'],
  ['0,190', '0', '0'],
  ['1500.50', '1501', '1501'],
  ['1.5', '2', '2'],
  ['1.2345', '1', '1'],
  ['1500.', '1500', '1500'],
  // Negativos y adornos.
  ['-1.500.000', '-1500000', '-1500000'],
  ['$-1.500', '-1500', '-1500'],
  ['(1.500)', '(1.500)', '(1.500)'],
  ['19%', '19', '19'],
  ['1500 COP', '1500', '1500'],
  ['COP 1.500.000', 'COP 1.500.000', 'COP 1.500.000'],
  ['$ 1 500 000', '1500000', '1500000'],
  // Sin número: queda como llegó.
  ['sin valor', 'sin valor', 'sin valor'],
  ['$', '$', '$'],
  // Miles con coma: lo que este cambio corrige.
  ['1,500,000', '2', '1500000'],
  ['1,234,567.89', '1', '1234568'],
  ['1,500,000.00', '2', '1500000'],
  ['$ 98,500,000', '99', '98500000'],
  ['-1,500,000', '-1', '-1500000'],
  ['350,906', '351', '350906'],
  ['12,500', '13', '12500'],
]

describe('normalizarMontoExtraido — antes y ahora', () => {
  it.each(TABLA)('%s: antes %s, ahora %s', (entrada, antes, ahora) => {
    expect(anterior(entrada)).toBe(antes) // la tabla describe bien el código viejo
    expect(normalizarMontoExtraido(entrada)).toBe(ahora)
  })

  it('solo cambian los miles escritos con coma', () => {
    const cambian = TABLA.filter(([e]) => anterior(e) !== normalizarMontoExtraido(e)).map(([e]) => e)
    expect(cambian).toEqual([
      '1,500,000', '1,234,567.89', '1,500,000.00', '$ 98,500,000', '-1,500,000', '350,906', '12,500',
    ])
  })

  // Barrido: todo número que el modelo pueda devolver sin separadores, o en formato
  // colombiano, da exactamente lo mismo que antes.
  it('los formatos que ya se leían bien no cambian en ningún valor', () => {
    const colombiano = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })
    for (const n of [0, 7, 42, 999, 1000, 1500, 64200, 350906, 701812, 5439880, 98500000, 1234567.89, 0.19, 12.5]) {
      for (const texto of [String(n), colombiano(n), `$ ${colombiano(n)}`, `-${colombiano(n)}`]) {
        expect(normalizarMontoExtraido(texto)).toBe(anterior(texto))
      }
    }
  })
})
