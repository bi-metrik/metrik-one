import { describe, expect, it } from 'vitest'

import { topeDelPresupuesto } from './presupuesto-del-viaje'

describe('topeDelPresupuesto · el techo del presupuesto de la solicitud (M-H2-2)', () => {
  it('los valores del select de Trappvel', () => {
    expect(topeDelPresupuesto('menos_3m')).toBe(3_000_000)
    expect(topeDelPresupuesto('3m_5m')).toBe(5_000_000)
    expect(topeDelPresupuesto('5m_8m')).toBe(8_000_000)
    expect(topeDelPresupuesto('8m_12m')).toBe(12_000_000)
    expect(topeDelPresupuesto('12m_20m')).toBe(20_000_000)
    expect(topeDelPresupuesto('mas_20m')).toBe(Infinity)
    expect(topeDelPresupuesto('sin_definir')).toBeNull()
  })

  it('sus etiquetas y textos escritos a mano', () => {
    expect(topeDelPresupuesto('Entre $8 y $12 millones')).toBe(12_000_000)
    expect(topeDelPresupuesto('Menos de $3 millones')).toBe(3_000_000)
    expect(topeDelPresupuesto('Más de $20 millones')).toBe(Infinity)
    expect(topeDelPresupuesto('Aún no tiene presupuesto definido')).toBeNull()
    expect(topeDelPresupuesto('9 a 10 millones')).toBe(10_000_000)
    expect(topeDelPresupuesto('hasta 12.000.000')).toBe(12_000_000)
    expect(topeDelPresupuesto('8,5 millones')).toBe(8_500_000)
  })

  it('sin dato, null', () => {
    expect(topeDelPresupuesto(null)).toBeNull()
    expect(topeDelPresupuesto('')).toBeNull()
    expect(topeDelPresupuesto('lo que sea')).toBeNull()
    expect(topeDelPresupuesto({})).toBeNull()
  })
})
