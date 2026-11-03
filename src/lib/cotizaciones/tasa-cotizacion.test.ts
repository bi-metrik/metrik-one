import { describe, expect, it } from 'vitest'

import {
  planDePropagacion,
  tasaComoTexto,
  tasaDeCotizacionPara,
  tasasDeCotizacion,
  textoTasaPropagada,
  type LineaConTasa,
} from './tasa-cotizacion'

const COMP = { adultos: 2, ninos: 0, infantes: 0 }
const lectura = (moneda: string, total: number, leidaEn = '2026-10-29T10:00:00Z') => ({ moneda, total, porTipo: [], leidaEn })
const confirmada = (moneda: string, tasa: number | null, en: string) => ({
  composicion: COMP, costos: [], costoTotalCOP: 1, moneda, tasa, confirmadaEn: en,
})

function linea(id: string, tarifa: Record<string, unknown>, subtotal = 0): LineaConTasa {
  return { id, tarifa_pax: tarifa, subtotal }
}

describe('tasa de la cotización (H5/H28 QA Trappvel 2026-10-29)', () => {
  const lineas = [
    linea('a', { casillas: { grupo_completo: lectura('USD', 1674) }, confirmada: confirmada('USD', 4150, '2026-10-29T10:00:00Z') }),
    linea('b', { casillas: { grupo_completo: lectura('USD', 90) } }),
    linea('c', { casillas: { grupo_completo: lectura('EUR', 500) }, confirmada: confirmada('EUR', 4500, '2026-10-29T11:00:00Z') }),
    linea('d', { casillas: { grupo_completo: lectura('COP', 3_789_200) }, confirmada: confirmada('COP', null, '2026-10-29T12:00:00Z') }),
    linea('e', { costoManual: { moneda: 'USD', valor: 100, tasa: 4200, por: null, porId: null, en: '2026-10-29T13:00:00Z' } }, 420_000),
  ]

  it('es la última escrita en cualquier línea de esa moneda', () => {
    const t = tasasDeCotizacion(lineas)
    expect(t.USD.tasa).toBe(4200)
    expect(t.EUR.tasa).toBe(4500)
    expect(t.COP).toBeUndefined()
  })

  it('no cuenta la de la línea que se está confirmando', () => {
    expect(tasaDeCotizacionPara(lineas, 'usd', 'e')).toBe(4150)
    expect(tasaDeCotizacionPara(lineas, 'COP')).toBeNull()
    expect(tasaDeCotizacionPara(lineas, 'MXN')).toBeNull()
  })

  it('un costo a mano que ya no explica los pesos no da tasa', () => {
    const vieja = [linea('x', { costoManual: { moneda: 'USD', valor: 100, tasa: 9999, por: null, porId: null, en: '2026-10-30T00:00:00Z' } }, 1)]
    expect(tasaDeCotizacionPara(vieja, 'USD')).toBeNull()
  })

  it('al escribirla llega a las demás líneas de la misma moneda, no a las otras', () => {
    const plan = planDePropagacion(lineas, 'USD', 4230, 'a')
    expect(plan.reconfirmar).toEqual(['b'])
    expect(plan.costoManual).toEqual([{ id: 'e', valor: 100 }])
  })

  it('una línea ya costeada con esa tasa no se toca', () => {
    expect(planDePropagacion(lineas, 'USD', 4150, 'b').reconfirmar).toEqual([])
  })

  it('una moneda supuesta no recibe tasa', () => {
    const supuesta = [linea('s', { casillas: { grupo_completo: { ...lectura('USD', 10), monedaAsumida: true } } })]
    expect(planDePropagacion(supuesta, 'USD', 4150, 'otra').reconfirmar).toEqual([])
  })

  it('en pesos no hay nada que propagar', () => {
    expect(planDePropagacion(lineas, 'COP', 1, 'a')).toEqual({ reconfirmar: [], costoManual: [] })
  })

  it('textos', () => {
    expect(tasaComoTexto(4150)).toBe('4.150')
    expect(tasaComoTexto(4150.5)).toBe('4.150,5')
    expect(textoTasaPropagada('usd', 1)).toBe('La tasa quedó también en 1 línea más en USD.')
    expect(textoTasaPropagada('EUR', 6)).toBe('La tasa quedó también en 6 líneas más en EUR.')
  })
})
