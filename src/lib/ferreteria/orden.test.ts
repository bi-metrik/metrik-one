import { describe, expect, it } from 'vitest'
import { compararValores, fechaComoNumero, ordenarFilas } from './orden'

const id = <T,>(x: T) => x

describe('ordenarFilas', () => {
  it('el código MP va en orden natural: MP-2 antes que MP-10', () => {
    expect(ordenarFilas(['MP-10', 'MP-2', 'MP-01', 'MP-100'], id, 'asc')).toEqual(['MP-01', 'MP-2', 'MP-10', 'MP-100'])
    expect(ordenarFilas(['MP-10', 'MP-2', 'MP-01', 'MP-100'], id, 'desc')).toEqual(['MP-100', 'MP-10', 'MP-2', 'MP-01'])
  })

  it('los números se ordenan como número, no como texto', () => {
    expect(ordenarFilas([100, 20, 3, -5], id, 'asc')).toEqual([-5, 3, 20, 100])
    expect(ordenarFilas([0.106, 0.27, -0.05], id, 'desc')).toEqual([0.27, 0.106, -0.05])
  })

  it('los vacíos van al final en las dos direcciones', () => {
    const datos = [null, 5, undefined, 1, Number.NaN, 3]
    expect(ordenarFilas(datos, id, 'asc').slice(0, 3)).toEqual([1, 3, 5])
    expect(ordenarFilas(datos, id, 'desc').slice(0, 3)).toEqual([5, 3, 1])
    expect(ordenarFilas(['b', '', 'a', null], id, 'desc')).toEqual(['b', 'a', '', null])
  })

  it('las fechas se ordenan como fecha', () => {
    const f = ['2026-09-24', '2026-10-01', '2026-09-03T08:00:00Z']
    expect(ordenarFilas(f, fechaComoNumero, 'asc')).toEqual(['2026-09-03T08:00:00Z', '2026-09-24', '2026-10-01'])
    expect(fechaComoNumero('no es fecha')).toBeNull()
  })

  it('el texto no distingue mayúsculas ni tildes', () => {
    expect(ordenarFilas(['taladro', 'Árbol', 'broca'], id, 'asc')).toEqual(['Árbol', 'broca', 'taladro'])
  })

  it('es estable: a igual valor respeta el orden de llegada', () => {
    const filas = [{ k: 1, n: 'a' }, { k: 0, n: 'b' }, { k: 1, n: 'c' }]
    expect(ordenarFilas(filas, (f) => f.k, 'desc').map((f) => f.n)).toEqual(['a', 'c', 'b'])
  })

  it('no muta el arreglo original', () => {
    const orig = [3, 1, 2]
    ordenarFilas(orig, id, 'asc')
    expect(orig).toEqual([3, 1, 2])
  })

  it('dos vacíos empatan', () => {
    expect(compararValores(null, undefined, 'asc')).toBe(0)
  })
})
