import { describe, it, expect } from 'vitest'
import { origenDelMargen, etiquetaOrigenMargen, formatMargenPct } from './margen-vista'

describe('origenDelMargen', () => {
  it('una línea sin margen propio HEREDA el de la cotización', () => {
    expect(origenDelMargen({ margenPropio: false, precioManual: false })).toBe('heredado')
  })

  it('una línea con margen propio es una excepción declarada', () => {
    expect(origenDelMargen({ margenPropio: true, precioManual: false })).toBe('propio')
  })

  it('el precio escrito a mano MANDA sobre el margen propio', () => {
    // Las dos marcas pueden convivir: alguien le puso margen propio y después
    // escribió el precio. En ese caso el margen sale del precio, así que apuntar al
    // campo de margen mandaría a tocar el campo que ya no gobierna la cifra.
    expect(origenDelMargen({ margenPropio: true, precioManual: true })).toBe('manual')
    expect(origenDelMargen({ margenPropio: false, precioManual: true })).toBe('manual')
  })
})

describe('etiquetaOrigenMargen', () => {
  it('distingue heredar de marginar aparte: es lo que un 0% no dice solo', () => {
    expect(etiquetaOrigenMargen('heredado')).toContain('hereda')
    expect(etiquetaOrigenMargen('propio')).toContain('propio')
    expect(etiquetaOrigenMargen('manual')).toContain('mano')
  })

  it('los tres orígenes dicen algo distinto', () => {
    const textos = (['heredado', 'propio', 'manual'] as const).map(etiquetaOrigenMargen)
    expect(new Set(textos).size).toBe(3)
  })
})

describe('formatMargenPct', () => {
  it('un decimal y coma, que es la convención local', () => {
    expect(formatMargenPct(15)).toBe('15,0%')
    expect(formatMargenPct(3.06)).toBe('3,1%')
    expect(formatMargenPct(-6.5)).toBe('-6,5%')
  })

  it('sin margen medible NO devuelve "0,0%"', () => {
    // Un cero afirma que la línea se vende a costo. Lo único cierto cuando no hay
    // precio o no hay costo es que todavía no hay con qué medirla.
    expect(formatMargenPct(null)).toBeNull()
    expect(formatMargenPct(undefined)).toBeNull()
    expect(formatMargenPct(Number.NaN)).toBeNull()
    expect(formatMargenPct(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('el cero REAL sí se imprime', () => {
    expect(formatMargenPct(0)).toBe('0,0%')
  })
})
