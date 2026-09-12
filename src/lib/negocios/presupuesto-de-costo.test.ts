import { describe, it, expect } from 'vitest'
import { presupuestoDeCosto, type RubroPresupuesto } from './presupuesto-ejecucion'

const rubro = (tipo: string, total: number): RubroPresupuesto =>
  ({ tipo, nombre: tipo, total } as RubroPresupuesto)

describe('presupuestoDeCosto', () => {
  it('suma los rubros cuando los hay', () => {
    expect(presupuestoDeCosto([rubro('materiales', 100), rubro('transporte', 50)], 999)).toBe(150)
  })

  it('los rubros mandan sobre el total de la cotización', () => {
    // Mutación que mata: leer `costo_total` primero devolvería 999 y el desglose por
    // rubro dejaría de cuadrar con la barra gruesa de la misma pantalla.
    expect(presupuestoDeCosto([rubro('materiales', 100)], 999)).toBe(100)
  })

  it('cae al costo total de la cotización cuando no hay rubros', () => {
    // El caso real de Termotech: COT-2026-0003, 12 ítems sin rubros y $123.925.695 de
    // costo cargado como total.
    expect(presupuestoDeCosto([], 123_925_695)).toBe(123_925_695)
  })

  it('sin rubros y sin costo total no hay presupuesto, y eso no es cero', () => {
    // `undefined`, no 0: una barra con denominador cero se pinta llena y se lee como
    // sobrecosto total.
    expect(presupuestoDeCosto([], 0)).toBeUndefined()
    expect(presupuestoDeCosto([], null)).toBeUndefined()
    expect(presupuestoDeCosto([], undefined)).toBeUndefined()
  })

  it('un costo total negativo no se toma como presupuesto', () => {
    expect(presupuestoDeCosto([], -5000)).toBeUndefined()
  })
})
