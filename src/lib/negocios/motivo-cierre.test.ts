/**
 * El criterio único de "negocio cerrado".
 *
 * EL CASO QUE IMPORTA: es una lista CERRADA de tres estados, no un
 * `estado !== 'abierto'`. En producción conviven negocios con `estado = 'activo'`
 * (2 filas del workspace `metrik`, medido el 2026-09-10) y un criterio laxo los
 * dejaría de solo lectura sin que nadie los haya cerrado.
 *
 * MUTACIONES MEDIDAS el 2026-09-10 sobre las 4 suites del frente (26 verdes en la
 * linea base). Los conteos son los observados, no estimados:
 *   · `negocioCerrado` con `estado !== 'abierto'`   → 6 rojas
 *   · `negocioCerrado` devolviendo siempre `false`  → 6 rojas
 *   · quitar `cancelado` del mapa de desenlaces     → 4 rojas
 */
import { describe, it, expect } from 'vitest'
import { motivoCierreDeEstado, negocioCerrado, MENSAJE_NEGOCIO_CERRADO } from './motivo-cierre'

describe('negocioCerrado', () => {
  it('los tres desenlaces del producto están cerrados', () => {
    expect(negocioCerrado('completado')).toBe(true)
    expect(negocioCerrado('perdido')).toBe(true)
    expect(negocioCerrado('cancelado')).toBe(true)
  })

  it('un negocio abierto no está cerrado', () => {
    expect(negocioCerrado('abierto')).toBe(false)
  })

  it('⚠️ `activo` NO es cerrado: existe en producción y nadie lo cerró', () => {
    expect(negocioCerrado('activo')).toBe(false)
  })

  it('un estado que aparezca mañana no se da por cerrado', () => {
    expect(negocioCerrado('en_revision')).toBe(false)
  })

  it('sin estado no hay cierre (null / undefined / vacío)', () => {
    expect(negocioCerrado(null)).toBe(false)
    expect(negocioCerrado(undefined)).toBe(false)
    expect(negocioCerrado('')).toBe(false)
  })

  it('es exactamente "tiene desenlace": un solo predicado, no dos', () => {
    for (const e of ['completado', 'perdido', 'cancelado', 'abierto', 'activo', 'otro', null]) {
      expect(negocioCerrado(e)).toBe(motivoCierreDeEstado(e) !== null)
    }
  })
})

describe('MENSAJE_NEGOCIO_CERRADO', () => {
  it('dice qué pasó y qué hacer, no solo que no se puede', () => {
    expect(MENSAJE_NEGOCIO_CERRADO).toContain('cerrado')
    expect(MENSAJE_NEGOCIO_CERRADO.toLowerCase()).toContain('reábrelo')
  })
})
