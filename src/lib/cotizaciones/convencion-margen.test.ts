import { describe, it, expect } from 'vitest'
import {
  politicaMargenDeLinea,
  etiquetaCampoMargen,
  nivelDeMargen,
  umbralesDeCotizacion,
  POLITICA_MARGEN_POR_DEFECTO,
  UMBRALES_MARGEN_POR_DEFECTO,
  PISO_MARGEN_PCT_POR_DEFECTO,
  AVISO_MARGEN_PCT_POR_DEFECTO,
} from './convencion-margen'
import { CONVENCION_MARGEN_POR_DEFECTO } from './precio-item'

describe('politicaMargenDeLinea', () => {
  it('lee lo que la línea declara', () => {
    expect(politicaMargenDeLinea({ margen: { convencion: 'sobre_venta', default_pct: 15 } }))
      .toEqual({
        convencion: 'sobre_venta',
        defaultPct: 15,
        pisoPct: PISO_MARGEN_PCT_POR_DEFECTO,
        avisoPct: AVISO_MARGEN_PCT_POR_DEFECTO,
      })
  })

  it('una línea que no declara nada conserva el comportamiento previo', () => {
    // Lo que importa es que una línea muda caiga SIEMPRE en la política por defecto,
    // sea cual sea. Fijar aquí el valor concreto convertiría esta prueba en un eco de
    // la constante, y dejaría de vigilar lo único que puede romperse: que un jsonb
    // vacío cambie el precio por un camino distinto al del default.
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

  it('una convención que no reconocemos cae en el default, no adivina', () => {
    expect(politicaMargenDeLinea({ margen: { convencion: 'divisor', default_pct: 15 } }).convencion)
      .toBe(CONVENCION_MARGEN_POR_DEFECTO)
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

describe('umbrales de la línea', () => {
  it('lee piso y aviso propios de la línea', () => {
    const p = politicaMargenDeLinea({ margen: { convencion: 'sobre_venta', default_pct: 15, piso_pct: 7, aviso_pct: 12 } })
    expect(p.pisoPct).toBe(7)
    expect(p.avisoPct).toBe(12)
  })

  it('una línea que solo declara uno conserva el default del otro', () => {
    const p = politicaMargenDeLinea({ margen: { piso_pct: 7 } })
    expect(p.pisoPct).toBe(7)
    expect(p.avisoPct).toBe(AVISO_MARGEN_PCT_POR_DEFECTO)
  })

  it('descarta un umbral fuera de [0, 100) en vez de acercarlo', () => {
    for (const pct of [100, 150, -1, Number.NaN, 'siete']) {
      const p = politicaMargenDeLinea({ margen: { piso_pct: pct, aviso_pct: pct } })
      expect(p.pisoPct).toBe(PISO_MARGEN_PCT_POR_DEFECTO)
      expect(p.avisoPct).toBe(AVISO_MARGEN_PCT_POR_DEFECTO)
    }
  })

  it('acepta el cero: "sin piso" es una decisión legítima', () => {
    expect(politicaMargenDeLinea({ margen: { piso_pct: 0 } }).pisoPct).toBe(0)
  })
})

describe('nivelDeMargen', () => {
  const umbrales = { pisoPct: 5, avisoPct: 10 }

  it('bajo el piso es rojo, no aviso', () => {
    expect(nivelDeMargen(3.1, umbrales)).toBe('bajo_piso')
    expect(nivelDeMargen(4.99, umbrales)).toBe('bajo_piso')
  })

  it('entre el piso y el aviso es ámbar', () => {
    expect(nivelDeMargen(5, umbrales)).toBe('aviso')
    expect(nivelDeMargen(9.9, umbrales)).toBe('aviso')
  })

  it('en el aviso y por encima no se marca', () => {
    expect(nivelDeMargen(10, umbrales)).toBe('ok')
    expect(nivelDeMargen(15, umbrales)).toBe('ok')
  })

  it('un margen negativo cae bajo el piso: es el caso que más importa', () => {
    expect(nivelDeMargen(-6.5, umbrales)).toBe('bajo_piso')
  })

  it('sin margen medible no se juzga', () => {
    expect(nivelDeMargen(null, umbrales)).toBe('sin_dato')
    expect(nivelDeMargen(undefined, umbrales)).toBe('sin_dato')
    expect(nivelDeMargen(Number.NaN, umbrales)).toBe('sin_dato')
  })

  it('un piso por encima del aviso deja la banda ámbar vacía, sin caso especial', () => {
    const invertidos = { pisoPct: 12, avisoPct: 8 }
    expect(nivelDeMargen(9, invertidos)).toBe('bajo_piso')
    expect(nivelDeMargen(12, invertidos)).toBe('ok')
  })

  it('sin umbrales explícitos rigen los del producto', () => {
    expect(nivelDeMargen(PISO_MARGEN_PCT_POR_DEFECTO - 0.1)).toBe('bajo_piso')
    expect(nivelDeMargen(AVISO_MARGEN_PCT_POR_DEFECTO)).toBe('ok')
  })
})

describe('umbralesDeCotizacion', () => {
  const linea = { pisoPct: 7, avisoPct: 12 }

  it('lo congelado en la cotización MANDA sobre la línea', () => {
    expect(umbralesDeCotizacion({ pisoPct: 5, avisoPct: 10 }, linea)).toEqual({ pisoPct: 5, avisoPct: 10 })
  })

  it('subir el piso de la línea no toca una cotización ya congelada', () => {
    const congelada = { pisoPct: 5, avisoPct: 10 }
    expect(umbralesDeCotizacion(congelada, { pisoPct: 30, avisoPct: 40 })).toEqual(congelada)
  })

  it('una cotización sin congelar cae a la política vigente de su línea', () => {
    expect(umbralesDeCotizacion(null, linea)).toEqual(linea)
    expect(umbralesDeCotizacion({}, linea)).toEqual(linea)
    expect(umbralesDeCotizacion({ pisoPct: null, avisoPct: null }, linea)).toEqual(linea)
  })

  it('congela cada umbral por separado', () => {
    expect(umbralesDeCotizacion({ pisoPct: 5, avisoPct: null }, linea)).toEqual({ pisoPct: 5, avisoPct: 12 })
  })

  it('un cero congelado NO cae a la línea: es un piso declarado', () => {
    expect(umbralesDeCotizacion({ pisoPct: 0, avisoPct: 0 }, linea)).toEqual({ pisoPct: 0, avisoPct: 0 })
  })

  it('sin línea ni congelado rigen los umbrales del producto', () => {
    expect(umbralesDeCotizacion(null)).toEqual(UMBRALES_MARGEN_POR_DEFECTO)
  })
})
