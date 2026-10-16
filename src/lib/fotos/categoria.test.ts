import { describe, expect, it } from 'vitest'

import { esCategoria, fotosPorCategoria, puestoParaCategoria } from './categoria'

const f = (id: string, categoria: string | null, posicion: number, principal = false) =>
  ({ id, categoria: categoria as never, posicion, principal })

describe('reparto por categoría: una de cada una, la principal la decide la asesora', () => {
  it('un hotel vacío o con puesto libre agrega', () => {
    expect(puestoParaCategoria([], 'fachada')).toEqual({ tipo: 'agregar' })
    expect(puestoParaCategoria([f('a', 'fachada', 1, true)], 'habitacion')).toEqual({ tipo: 'agregar' })
  })

  it('si ya hay una de esa categoría, la reemplaza (aunque quepa otra)', () => {
    expect(puestoParaCategoria([f('a', 'fachada', 1, true), f('b', 'habitacion', 2)], 'habitacion')).toEqual({ tipo: 'reemplazar', id: 'b' })
    // Reemplazar la principal la deja principal: conserva su puesto (lo hace guardarFoto).
    expect(puestoParaCategoria([f('a', 'fachada', 1, true)], 'fachada')).toEqual({ tipo: 'reemplazar', id: 'a' })
  })

  it('lleno: sale una sin categoría, luego una repetida, nunca la principal si hay otra', () => {
    expect(puestoParaCategoria([f('a', 'fachada', 1, true), f('b', null, 2), f('c', 'habitacion', 3)], 'zonas_comunes')).toEqual({ tipo: 'reemplazar', id: 'b' })
    expect(puestoParaCategoria([f('a', 'habitacion', 1, true), f('b', 'habitacion', 2), f('c', 'fachada', 3)], 'zonas_comunes')).toEqual({ tipo: 'reemplazar', id: 'b' })
    expect(puestoParaCategoria([f('a', null, 1, true), f('b', 'fachada', 2), f('c', 'habitacion', 3)], 'zonas_comunes')).toEqual({ tipo: 'reemplazar', id: 'a' })
  })

  it('lleno con las tres categorías distintas: la que ya está de esa categoría se cambia', () => {
    const tres = [f('a', 'fachada', 1, true), f('b', 'habitacion', 2), f('c', 'zonas_comunes', 3)]
    expect(puestoParaCategoria(tres, 'zonas_comunes')).toEqual({ tipo: 'reemplazar', id: 'c' })
    expect(puestoParaCategoria(tres, null)).toEqual({ tipo: 'tope' })
    expect(puestoParaCategoria(tres, 'otra')).toEqual({ tipo: 'tope' })
  })

  it('sin categoría solo agrega si cabe', () => {
    expect(puestoParaCategoria([f('a', 'fachada', 1, true)], null)).toEqual({ tipo: 'agregar' })
  })

  it('agrupa las fotos por pestaña; las viejas sin categoría quedan aparte', () => {
    const g = fotosPorCategoria([f('a', 'fachada', 1, true), f('b', null, 2), f('c', 'fachada', 3)])
    expect(g.fachada?.id).toBe('a')
    expect(g.habitacion).toBeNull()
    expect(g.sin.map((x) => x.id)).toEqual(['b', 'c'])
  })

  it('solo las cuatro categorías valen', () => {
    expect(esCategoria('habitacion')).toBe(true)
    expect(esCategoria('no_es_hotel')).toBe(false)
    expect(esCategoria(null)).toBe(false)
  })
})
