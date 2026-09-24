/**
 * Los reprocesos del caso en la tarjeta de datos clave, cerrados incluidos. V0457 tuvo el
 * reproceso 1 de Certificación UPME abierto el 21-sep y cerrado solo el 22-sep, y en la
 * ficha «salía como que no tuvo reproceso» porque solo se pintaba la marca vigente.
 */
import { describe, expect, it } from 'vitest'
import { resumirReprocesos } from './datos-clave'

describe('resumirReprocesos', () => {
  it('V0457: el reproceso cerrado se ve con su fecha de cierre en Bogotá', () => {
    const [r] = resumirReprocesos([
      { ciclo: 1, tipo: 'certificacion_upme', abierto_at: '2026-09-21T22:04:45.282+00:00', cerrado_at: '2026-09-22T22:34:14.87+00:00' },
    ])
    expect(r.activo).toBe(false)
    expect(r.texto).toBe('Reproceso 1 · Certificación UPME · cerrado 22-sep')
  })

  it('en orden de apertura, el activo lo dice, y el error sin retorno lleva su nombre', () => {
    const rs = resumirReprocesos([
      { ciclo: 2, tipo: 'devolucion_dian', abierto_at: '2026-09-23T15:00:00Z', cerrado_at: null },
      { ciclo: 0, tipo: 'devolucion_dian', abierto_at: '2026-09-10T15:00:00Z', cerrado_at: '2026-09-10T15:00:00Z' },
      { ciclo: 1, tipo: 'certificacion_upme', abierto_at: '2026-09-15T15:00:00Z', cerrado_at: '2026-09-16T15:00:00Z' },
    ])
    expect(rs.map(r => r.ciclo)).toEqual([0, 1, 2])
    expect(rs[0].texto).toBe('Error registrado sin devolver el caso · Devolución DIAN · 10-sep')
    expect(rs[2].activo).toBe(true)
    expect(rs[2].texto).toBe('Reproceso 2 · Devolución DIAN · abierto desde 23-sep')
  })

  it('la fecha es la de Bogotá: las 7 p. m. del 30 no son el 31', () => {
    const [r] = resumirReprocesos([{ ciclo: 1, tipo: 'certificacion_upme', abierto_at: '2026-09-01T00:30:00Z', cerrado_at: '2026-10-01T00:30:00Z' }])
    expect(r.texto).toBe('Reproceso 1 · Certificación UPME · cerrado 30-sep')
  })

  it('un tipo desconocido se muestra tal cual, sin inventarle nombre', () => {
    const [r] = resumirReprocesos([{ ciclo: 1, tipo: 'otro_tipo', abierto_at: '2026-09-01T15:00:00Z', cerrado_at: null }])
    expect(r.texto).toContain('otro_tipo')
  })
})
