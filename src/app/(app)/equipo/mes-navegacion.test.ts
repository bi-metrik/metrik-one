/**
 * El periodo de /equipo: como se lee de la URL y como se mueve.
 *
 * Vale la pena probarlo aparte del componente porque son los dos puntos donde esto se
 * rompe sin hacer ruido: diciembre + 1 (que no es el mes 13) y un `?mes=` con basura,
 * que antes llegaba a la RPC como NaN, viajaba como `null` y devolvia el HISTORICO
 * completo. O sea: la pantalla vieja, disfrazada de mes.
 */
import { describe, it, expect } from 'vitest'
import { mesConDelta, paramMes, etiquetaMes, parsearPeriodo } from './mes-navegacion'

describe('mesConDelta', () => {
  it('cruza el fin de anio hacia adelante', () => {
    expect(mesConDelta(2026, 12, 1)).toEqual({ anio: 2027, mes: 1 })
  })

  it('cruza el fin de anio hacia atras', () => {
    expect(mesConDelta(2026, 1, -1)).toEqual({ anio: 2025, mes: 12 })
  })

  it('se mueve dentro del anio', () => {
    expect(mesConDelta(2026, 9, -1)).toEqual({ anio: 2026, mes: 8 })
    expect(mesConDelta(2026, 9, 1)).toEqual({ anio: 2026, mes: 10 })
  })
})

describe('paramMes / etiquetaMes', () => {
  it('el parametro de la URL siempre lleva dos digitos', () => {
    expect(paramMes(2026, 9)).toBe('2026-09')
    expect(paramMes(2026, 12)).toBe('2026-12')
  })

  it('la etiqueta es la que ve el usuario', () => {
    expect(etiquetaMes(2026, 9)).toBe('Septiembre 2026')
  })
})

describe('parsearPeriodo', () => {
  it('un mes valido en la URL manda sobre el respaldo', () => {
    expect(parsearPeriodo('2026-07', '2026-09')).toEqual({ anio: 2026, mes: 7 })
  })

  it('sin parametro cae al mes en curso', () => {
    expect(parsearPeriodo(undefined, '2026-09')).toEqual({ anio: 2026, mes: 9 })
  })

  it('un parametro con basura NO se convierte en periodo nulo (historico)', () => {
    expect(parsearPeriodo('acumulado', '2026-09')).toEqual({ anio: 2026, mes: 9 })
    expect(parsearPeriodo('2026-13', '2026-09')).toEqual({ anio: 2026, mes: 9 })
    expect(parsearPeriodo('sin-sentido', '2026-09')).toEqual({ anio: 2026, mes: 9 })
  })

  it('nunca devuelve un mes fuera de rango, aunque el respaldo tambien venga roto', () => {
    const p = parsearPeriodo('xx', 'yy')
    expect(p.mes).toBeGreaterThanOrEqual(1)
    expect(p.mes).toBeLessThanOrEqual(12)
    expect(p.anio).toBeGreaterThan(2000)
  })
})
