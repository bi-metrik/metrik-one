import { describe, it, expect } from 'vitest'
import {
  politicaMargenDeLinea,
  etiquetaCampoMargen,
  margenPideAviso,
  POLITICA_MARGEN_POR_DEFECTO,
  UMBRAL_AVISO_MARGEN_PCT,
} from './convencion-margen'

describe('politicaMargenDeLinea', () => {
  it('lee lo que la línea declara', () => {
    expect(politicaMargenDeLinea({ margen: { convencion: 'sobre_venta', default_pct: 15 } }))
      .toEqual({ convencion: 'sobre_venta', defaultPct: 15 })
  })

  it('una línea que no declara nada conserva el comportamiento previo', () => {
    // No es una elección de diseño: markup y 0 son exactamente lo que ONE hacía antes.
    // Cambiarlo le movería el precio a los workspaces que ya estaban operando.
    expect(politicaMargenDeLinea(null)).toEqual(POLITICA_MARGEN_POR_DEFECTO)
    expect(politicaMargenDeLinea({})).toEqual(POLITICA_MARGEN_POR_DEFECTO)
    expect(politicaMargenDeLinea({ facturacion: { desde_etapa_numero: 4 } }))
      .toEqual(POLITICA_MARGEN_POR_DEFECTO)
  })

  it('un jsonb con otra forma no tumba el cálculo ni lo cambia en silencio', () => {
    expect(politicaMargenDeLinea('texto suelto')).toEqual(POLITICA_MARGEN_POR_DEFECTO)
    expect(politicaMargenDeLinea({ margen: 'sobre_venta' })).toEqual(POLITICA_MARGEN_POR_DEFECTO)
    expect(politicaMargenDeLinea({ margen: null })).toEqual(POLITICA_MARGEN_POR_DEFECTO)
  })

  it('una convención que no reconocemos cae en markup, no adivina', () => {
    expect(politicaMargenDeLinea({ margen: { convencion: 'divisor', default_pct: 15 } }))
      .toEqual({ convencion: 'markup', defaultPct: 15 })
  })

  it('descarta un default fuera de [0, 100) en vez de acercarlo', () => {
    // Con sobre_venta, 100 es la división por cero y por encima el precio se iría bajo
    // el costo. Corregirlo a 99 sería inventar una regla que nadie escribió.
    for (const pct of [100, 150, -1, Number.NaN, 'quince']) {
      expect(politicaMargenDeLinea({ margen: { convencion: 'sobre_venta', default_pct: pct } }).defaultPct)
        .toBe(POLITICA_MARGEN_POR_DEFECTO.defaultPct)
    }
  })

  it('conserva la convención aunque el default sea inválido', () => {
    expect(politicaMargenDeLinea({ margen: { convencion: 'sobre_venta', default_pct: 100 } }).convencion)
      .toBe('sobre_venta')
  })

  it('acepta los extremos válidos', () => {
    expect(politicaMargenDeLinea({ margen: { convencion: 'sobre_venta', default_pct: 0 } }).defaultPct).toBe(0)
    expect(politicaMargenDeLinea({ margen: { convencion: 'sobre_venta', default_pct: 99.9 } }).defaultPct).toBe(99.9)
  })
})

describe('etiquetaCampoMargen', () => {
  it('llama las cosas por su nombre: con markup el número NO es el margen', () => {
    expect(etiquetaCampoMargen('markup')).toBe('Recargo %')
    expect(etiquetaCampoMargen('sobre_venta')).toBe('Margen %')
  })
})

describe('margenPideAviso', () => {
  it('avisa por debajo del umbral', () => {
    expect(margenPideAviso(9.9)).toBe(true)
    expect(margenPideAviso(3)).toBe(true)
  })

  it('no avisa en el umbral ni por encima', () => {
    expect(margenPideAviso(UMBRAL_AVISO_MARGEN_PCT)).toBe(false)
    expect(margenPideAviso(13.04)).toBe(false)
    expect(margenPideAviso(15)).toBe(false)
  })

  it('un margen negativo avisa: es el caso que más importa', () => {
    expect(margenPideAviso(-6.5)).toBe(true)
  })

  it('un ítem sin precio no avisa: no hay margen que juzgar todavía', () => {
    expect(margenPideAviso(null)).toBe(false)
    expect(margenPideAviso(Number.NaN)).toBe(false)
  })
})
