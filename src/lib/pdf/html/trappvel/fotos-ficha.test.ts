/**
 * Regla de fotos de las fichas de hotel (Ren y Mauricio, 2026-10-29): siempre la grande y dos
 * apiladas, armadas por ONE con fotos sueltas; todas del mismo alto; nadie se recorta más del 15 %.
 */
import { describe, expect, it } from 'vitest'

import { formaAdmitida, MENSAJE_FORMA, ordenarPorCategoria, PROPORCION_MAXIMA, PROPORCION_MINIMA } from '@/lib/fotos/forma'
import { casillasDeFicha, formasDeCasillas, fotosQueFaltan, planDeFichas, recorte, RECORTE_MAXIMO, type CasillasFicha, type PlanDeFichas } from './fotos-ficha'
import { ANCHO_FOTO_FICHA_MM } from './plantilla'

const ANCHO = ANCHO_FOTO_FICHA_MM

/** Lo que se recorta cada foto puesta en una ficha. */
function recortes(p: number[], c: CasillasFicha, plan: PlanDeFichas): number[] {
  const f = formasDeCasillas(ANCHO, plan.altoMm, plan.grande)
  return [
    c.grande === null ? 0 : recorte(p[c.grande], f.grande),
    c.arriba === null ? 0 : recorte(p[c.arriba], f.pequena),
    c.abajo === null ? 0 : recorte(p[c.abajo], f.pequena),
  ]
}

const dentroDelTope = (fichas: number[][], plan: PlanDeFichas) =>
  plan.fichas.every((c, i) => recortes(fichas[i], c, plan).every((r) => r <= RECORTE_MAXIMO + 1e-9))

describe('la forma de una foto de hotel', () => {
  it('frena el tríptico (2,79) y la vertical (0,67) de la biblioteca; deja pasar 1,0 a 2,0', () => {
    expect([2.786, 0.669].map(formaAdmitida)).toEqual([false, false])
    expect([1, 1.365, 1.389, 1.417, 1.5, 1.78, 1.877, 2, 0.8].map(formaAdmitida)).toEqual(Array(9).fill(true))
    expect([PROPORCION_MINIMA, PROPORCION_MAXIMA]).toEqual([0.75, 2.1])
    // Sin medida no se frena (la mide el PDF al reducirla).
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

describe('la ficha: una grande y dos apiladas', () => {
  it('3 fotos de cerca de 1,4 (el Sunscape): las tres, la grande es la primera', () => {
    const p = [1.417, 1.385, 1.389]
    const plan = planDeFichas([p], ANCHO)
    expect(plan.fichas[0]).toEqual({ grande: 0, arriba: 1, abajo: 2 })
    expect(dentroDelTope([p], plan)).toBe(true)
    expect(fotosQueFaltan(plan)).toEqual([0])
  })

  it('la COT-2026-0008: el Sunscape sale con sus 3 aunque el Kunuku y el Dreams tengan una sola; las tres fichas del mismo alto', () => {
    const fichas = [[1.365], [1.389], [1.417, 1.385, 1.389]]
    const plan = planDeFichas(fichas, ANCHO)
    expect(plan.fichas).toEqual([
      { grande: 0, arriba: null, abajo: null },
      { grande: 0, arriba: null, abajo: null },
      { grande: 0, arriba: 1, abajo: 2 },
    ])
    expect(fotosQueFaltan(plan)).toEqual([2, 2, 0])
    expect(dentroDelTope(fichas, plan)).toBe(true)
    // Más bajo que la ficha de una sola foto ancha (60 mm) que salía antes de la corrección.
    expect(plan.altoMm).toBeLessThan(45)
  })

  it('el alto es el más bajo que pone todas las fotos posibles sin pasar del 15 %', () => {
    const fichas = [[1.5, 1.5, 1.5]]
    const plan = planDeFichas(fichas, ANCHO)
    expect(plan.fichas[0]).toEqual({ grande: 0, arriba: 1, abajo: 2 })
    const unoMenos = planDeFichas(fichas, ANCHO)
    expect(unoMenos.altoMm).toBe(plan.altoMm)
    // Con medio milímetro menos, con cualquier reparto, alguna no cabe.
    for (let g = 0.55; g <= 0.75; g += 0.01) {
      const c = casillasDeFicha(fichas[0], formasDeCasillas(ANCHO, plan.altoMm - 0.5, Math.round(g * 100) / 100))
      expect([c.grande, c.arriba, c.abajo].includes(null)).toBe(true)
    }
  })

  it('una foto que necesitaría recortarse más no se usa (la casilla queda con el degradado)', () => {
    // Una cuadrada no cabe en la grande con fotos de 3:2 en la ficha.
    const fichas = [[1.5, 1.5, 1.5], [1]]
    const plan = planDeFichas(fichas, ANCHO)
    expect(plan.fichas[0]).toEqual({ grande: 0, arriba: 1, abajo: 2 })
    expect(dentroDelTope(fichas, plan)).toBe(true)
  })

  it('ninguna foto de ningún plan se recorta más del 15 %', () => {
    const casos = [
      [[1.5, 1.33, 1.78], [1.5]],
      [[1.33, 1.33, 1.33], [1.5, 1.5], [1.78]],
      [[2, 1.5, 1.5]],
      [[1.877, 1.499, 1.499], [1.798, 1.746, 1]],
      [[0.8, 1.8]],
    ]
    for (const fichas of casos) expect(dentroDelTope(fichas, planDeFichas(fichas, ANCHO))).toBe(true)
  })

  it('sin fotos: el alto de siempre y todas las casillas vacías', () => {
    const plan = planDeFichas([[], []], ANCHO)
    expect(plan.altoMm).toBe(25)
    expect(fotosQueFaltan(plan)).toEqual([3, 3])
  })
})
