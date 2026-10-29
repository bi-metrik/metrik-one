/**
 * Regla de fotos de las fichas de hotel (Ren y Mauricio, 2026-10-29, segunda corrección): las fotos
 * buenas, hasta 3, del mismo tamaño y lado a lado; nadie se recorta más del 15 %; las fichas de cada
 * fila alineadas; nunca un recuadro vacío.
 */
import { describe, expect, it } from 'vitest'

import { formaAdmitida, MENSAJE_FORMA, ordenarPorCategoria, PROPORCION_MAXIMA, PROPORCION_MINIMA } from '@/lib/fotos/forma'
import { anchoDeCasilla, filasDeFichas, fotosDeFicha, fotosQueFaltan, rangoDeAltos, recorte, RECORTE_MAXIMO } from './fotos-ficha'
import { ANCHO_FOTO_FICHA_MM } from './plantilla'

const ANCHO = ANCHO_FOTO_FICHA_MM

/** Lo que se recorta cada foto de la ficha con ese alto. */
const recortes = (p: number[], alto: number) => p.map((x) => recorte(x, anchoDeCasilla(ANCHO, p.length) / alto))

describe('la forma de una foto de hotel', () => {
  it('frena el tríptico (2,79) y la vertical (0,67) de la biblioteca; deja pasar 1,0 a 2,0', () => {
    expect([2.786, 0.669].map(formaAdmitida)).toEqual([false, false])
    expect([1, 1.365, 1.389, 1.417, 1.5, 1.78, 1.877, 2, 0.8].map(formaAdmitida)).toEqual(Array(9).fill(true))
    expect([PROPORCION_MINIMA, PROPORCION_MAXIMA]).toEqual([0.75, 2.1])
    expect([null, undefined, Number.NaN].map(formaAdmitida)).toEqual([true, true, true])
    expect(MENSAJE_FORMA).toBe('Parece un collage o una foto vertical: sube una foto sola.')
  })

  it('el orden: fachada, las sin categoría (orden de la asesora), habitación, zonas comunes, otra', () => {
    const fotos = [
      { id: 'z', categoria: 'zonas_comunes' },
      { id: 'o', categoria: 'otra' },
      { id: 'h', categoria: 'habitacion' },
      { id: 'n1', categoria: null },
      { id: 'f', categoria: 'fachada' },
      { id: 'n2', categoria: null },
    ]
    expect(ordenarPorCategoria(fotos).map((f) => f.id)).toEqual(['f', 'n1', 'n2', 'h', 'z', 'o'])
  })
})

describe('la ficha: sus fotos lado a lado, del mismo tamaño', () => {
  it('3 fotos de cerca de 1,4 (el Sunscape): las tres, iguales, en un recuadro bajo', () => {
    const f = fotosDeFicha([1.417, 1.385, 1.389], ANCHO)
    expect(f.fotos).toEqual([0, 1, 2])
    expect(fotosQueFaltan(f)).toBe(0)
    const [fila] = filasDeFichas([f], ['Willemstad'], 2)
    expect(fila.altos[0]).toBeGreaterThan(19)
    expect(fila.altos[0]).toBeLessThan(27)
    for (const r of recortes([1.417, 1.385, 1.389], fila.altos[0]!)) expect(r).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
  })

  it('1 foto: una sola a todo lo ancho, con su alto (sin recortarla más del 15 %)', () => {
    const f = fotosDeFicha([1.365], ANCHO)
    expect(f.fotos).toEqual([0])
    const [fila] = filasDeFichas([f], [null], 2)
    expect(recorte(1.365, ANCHO / fila.altos[0]!)).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
    expect(fila.altos[0]).toBeGreaterThan(55)
  })

  it('una foto que no deja un alto común con las demás sin pasar el 15 % no sale; las primeras se quedan', () => {
    // Una cuadrada y dos de 16:9: las tres juntas no caben; van las dos primeras que sí.
    const f = fotosDeFicha([1, 1.78, 1.78], ANCHO)
    expect(f.fotos).toEqual([1, 2])
    expect(rangoDeAltos([1, 1.78, 1.78], ANCHO)).toBeNull()
  })

  it('el alto es el más bajo que no recorta ninguna más del 15 % (al medio milímetro)', () => {
    const r = rangoDeAltos([1.5, 1.5], ANCHO)!
    const [fila] = filasDeFichas([fotosDeFicha([1.5, 1.5], ANCHO)], [null], 2)
    expect(fila.altos[0]).toBeGreaterThanOrEqual(r[0] - 1e-9)
    expect(fila.altos[0]! - r[0]).toBeLessThan(0.5)
  })
})

describe('las filas: dos fichas alineadas', () => {
  it('la COT-2026-0008: el Kunuku y el Dreams (una foto cada uno) van juntos con el mismo alto; el Sunscape (3) aparte', () => {
    const fichas = [fotosDeFicha([1.365], ANCHO), fotosDeFicha([1.417, 1.385, 1.389], ANCHO), fotosDeFicha([1.389], ANCHO)]
    const filas = filasDeFichas(fichas, ['Willemstad', 'Willemstad', 'Willemstad'], 2)
    expect(filas.map((f) => f.fichas)).toEqual([[0, 2], [1]])
    expect(filas[0].alineada).toBe(true)
    expect(filas[0].altos[0]).toBe(filas[0].altos[1])
    for (const [i, p] of [[0, 1.365], [2, 1.389]] as const) expect(recorte(p, ANCHO / filas[0].altos[filas[0].fichas.indexOf(i)]!)).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
    expect(fichas.map(fotosQueFaltan)).toEqual([2, 0, 2])
  })

  it('no empareja fichas de ciudades distintas; sin pareja compatible va con la siguiente, cada una con su alto', () => {
    const fichas = [fotosDeFicha([1.4], ANCHO), fotosDeFicha([1.4, 1.4, 1.4], ANCHO), fotosDeFicha([1.4], ANCHO)]
    const filas = filasDeFichas(fichas, ['Madrid', 'Madrid', 'París'], 2)
    expect(filas.map((f) => f.fichas)).toEqual([[0, 1], [2]])
    expect(filas[0].alineada).toBe(false)
    expect(filas[0].altos[0]).not.toBe(filas[0].altos[1])
  })

  it('una ficha sin fotos no lleva recuadro', () => {
    const filas = filasDeFichas([fotosDeFicha([], ANCHO), fotosDeFicha([1.5], ANCHO)], [null, null], 2)
    expect(filas[0].altos[0]).toBeNull()
    expect(fotosQueFaltan(fotosDeFicha([], ANCHO))).toBe(3)
  })
})
