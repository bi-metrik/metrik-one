/**
 * Regla de fotos de las fichas de hotel (Ren y Mauricio, 2026-10-29, con el PDF final aprobado):
 * casillas iguales lado a lado (hasta 3); una foto de paneles ocupa tantas casillas como paneles;
 * nadie se recorta más de cerca del 17 %; un alto común para el documento si lo hay.
 */
import { describe, expect, it } from 'vitest'

import { formaAdmitida, formaPosible, MENSAJE_FORMA, ordenarPorCategoria, panelesPosibles, PROPORCION_MAXIMA, PROPORCION_MINIMA } from '@/lib/fotos/forma'
import { anchoDeFoto, filasDeFichas, fotosDeFicha, fotosQueFaltan, rangoDeAltos, recorte, RECORTE_MAXIMO, type FotoParaFicha } from './fotos-ficha'
import { ANCHO_FOTO_FICHA_MM } from './plantilla'

const ANCHO = ANCHO_FOTO_FICHA_MM
const f = (proporcion: number, paneles = 1): FotoParaFicha => ({ proporcion, paneles })

/** Lo que se recorta cada foto de la ficha con ese alto. */
function recortes(fotos: FotoParaFicha[], alto: number): number[] {
  const n = fotos.reduce((s, x) => s + (x.paneles ?? 1), 0)
  return fotos.map((x) => recorte(x.proporcion!, anchoDeFoto(ANCHO, n, x.paneles ?? 1) / alto))
}

/** Las fichas, con las fotos que salen y sus filas. */
function plan(fichas: FotoParaFicha[][], ciudades = fichas.map(() => 'Willemstad' as string | null)) {
  const elegidas = fichas.map((fs) => fotosDeFicha(fs, ANCHO))
  const fotos = fichas.map((fs, i) => elegidas[i].fotos.map((j) => fs[j]))
  return { elegidas, fotos, filas: filasDeFichas(elegidas, fotos, ciudades, 2, ANCHO) }
}

describe('la forma de una foto de hotel', () => {
  it('frena la vertical (0,67); una muy ancha puede ser de paneles (lo confirman los píxeles)', () => {
    expect([0.669, 2.786].map(formaAdmitida)).toEqual([false, false])
    expect([1, 1.365, 1.389, 1.417, 1.5, 1.78, 1.877, 2, 0.8].map(formaAdmitida)).toEqual(Array(9).fill(true))
    expect([PROPORCION_MINIMA, PROPORCION_MAXIMA]).toEqual([0.75, 2.1])
    expect([null, undefined, Number.NaN].map(formaAdmitida)).toEqual([true, true, true])
    expect(MENSAJE_FORMA).toBe('Parece un collage o una foto vertical: sube una foto sola.')
    // El díptico del Kunuku (2,79): 2 paneles de 1,39 o 3 de 0,93.
    expect(panelesPosibles(2.786)).toEqual([3, 2])
    expect(panelesPosibles(1.5)).toEqual([])
    expect([formaPosible(2.786), formaPosible(0.669), formaPosible(7)]).toEqual([true, false, false])
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
    expect(ordenarPorCategoria(fotos).map((x) => x.id)).toEqual(['f', 'n1', 'n2', 'h', 'z', 'o'])
  })
})

describe('la ficha: casillas iguales lado a lado', () => {
  it('3 fotos de cerca de 1,4: tres casillas, sin pasar el recorte', () => {
    const fotos = [f(1.417), f(1.385), f(1.389)]
    const { elegidas, filas } = plan([fotos])
    expect(elegidas[0]).toMatchObject({ fotos: [0, 1, 2], casillas: 3 })
    for (const r of recortes(fotos, filas[0].altos[0]!)) expect(r).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
  })

  it('un díptico (2 paneles) y una foto: el díptico en dos casillas y la foto en la tercera', () => {
    const fotos = [f(2.786, 2), f(1.365)]
    const { elegidas, filas } = plan([fotos])
    expect(elegidas[0]).toMatchObject({ fotos: [0, 1], casillas: 3 })
    expect(fotosQueFaltan(elegidas[0])).toBe(0)
    for (const r of recortes(fotos, filas[0].altos[0]!)) expect(r).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
  })

  it('1 foto: una sola a todo lo ancho, con su alto', () => {
    const { elegidas, filas } = plan([[f(1.365)]])
    expect(elegidas[0]).toMatchObject({ fotos: [0], casillas: 1 })
    expect(recorte(1.365, ANCHO / filas[0].altos[0]!)).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
    expect(filas[0].altos[0]).toBeGreaterThan(50)
  })

  it('una foto que no deja un alto común con las demás no sale; las primeras se quedan', () => {
    expect(fotosDeFicha([f(1), f(1.78), f(1.78)], ANCHO).fotos).toEqual([1, 2])
    expect(rangoDeAltos([f(1), f(1.78), f(1.78)], ANCHO)).toBeNull()
  })
})

describe('el alto: común al documento si lo hay; si no, por filas', () => {
  it('la COT-2026-0008 aprobada: Kunuku (díptico + habitación), Sunscape (3) y Dreams (3), todas del mismo alto y en su orden', () => {
    const fichas = [[f(2.786, 2), f(1.365)], [f(1.417), f(1.385), f(1.389)], [f(1.389), f(1.389), f(1.389)]]
    const { fotos, filas } = plan(fichas)
    expect(filas.map((x) => x.fichas)).toEqual([[0, 1], [2]])
    const altos = filas.flatMap((x) => x.altos)
    expect(new Set(altos).size).toBe(1)
    fotos.forEach((fs) => recortes(fs, altos[0]!).forEach((r) => expect(r).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)))
  })

  it('sin alto común: se emparejan en la misma ciudad las que lo comparten; si no, cada una con el suyo', () => {
    const fichas = [[f(1.365)], [f(1.417), f(1.385), f(1.389)], [f(1.389)]]
    const { filas } = plan(fichas)
    expect(filas.map((x) => x.fichas)).toEqual([[0, 2], [1]])
    expect(filas[0].altos[0]).toBe(filas[0].altos[1])
    const otra = plan([[f(1.4)], [f(1.4), f(1.4), f(1.4)], [f(1.4)]], ['Madrid', 'Madrid', 'París'])
    expect(otra.filas.map((x) => x.fichas)).toEqual([[0, 1], [2]])
    expect(otra.filas[0].alineada).toBe(false)
  })

  it('una ficha sin fotos no lleva recuadro', () => {
    const { elegidas, filas } = plan([[], [f(1.5)]])
    expect(filas[0].altos[0]).toBeNull()
    expect(fotosQueFaltan(elegidas[0])).toBe(3)
  })
})
