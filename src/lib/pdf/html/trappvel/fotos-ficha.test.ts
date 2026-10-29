/**
 * Regla de fotos de las fichas de hotel (Ren, 2026-10-29): 1 ancha · 2 iguales · 1 grande + 2
 * apiladas; todas del mismo alto; nadie se recorta más del 15 %.
 */
import { describe, expect, it } from 'vitest'

import { formaAdmitida, MENSAJE_FORMA, ordenarPorCategoria, PROPORCION_MAXIMA, PROPORCION_MINIMA } from '@/lib/fotos/forma'
import { ALTO_FOTO_FICHA_MM, distribucionDeFicha, ESPACIO_FOTOS_MM, planDeFichas, recorte, RECORTE_MAXIMO, type DistribucionFicha } from './fotos-ficha'
import { ANCHO_FOTO_FICHA_MM } from './plantilla'

const ANCHO = ANCHO_FOTO_FICHA_MM

/** Lo que se recorta cada foto de una ficha con esta distribución. */
function recortes(p: number[], d: DistribucionFicha, alto: number): number[] {
  const util = ANCHO - ESPACIO_FOTOS_MM
  if (d.tipo === 'una') return [recorte(p[d.fotos[0]], ANCHO / alto)]
  if (d.tipo === 'dos') return d.fotos.map((i) => recorte(p[i], util / 2 / alto))
  const chica = (util * (1 - d.grande)) / ((alto - ESPACIO_FOTOS_MM) / 2)
  return [recorte(p[d.fotos[0]], (util * d.grande) / alto), recorte(p[d.fotos[1]], chica), recorte(p[d.fotos[2]], chica)]
}

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

describe('la distribución de una ficha', () => {
  it('3 fotos de cerca de 1,4: una grande y dos apiladas, la grande es la primera', () => {
    const p = [1.417, 1.385, 1.389]
    const plan = planDeFichas([p], ANCHO)
    const d = plan.fichas[0]!
    expect(d.tipo).toBe('tres')
    expect(d.fotos).toEqual([0, 1, 2])
    for (const r of recortes(p, d, plan.altoMm)) expect(r).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
  })

  it('2 fotos de 3:2: dos iguales, en el recuadro más bajo que las recorta 15 % o menos', () => {
    const plan = planDeFichas([[1.5, 1.5]], ANCHO)
    expect(plan.fichas[0]!.tipo).toBe('dos')
    expect(plan.altoMm).toBeGreaterThan(25)
    expect(plan.altoMm).toBeLessThan(30)
    expect(distribucionDeFicha([1.5, 1.5], ANCHO, plan.altoMm - ALTO_FOTO_FICHA_MM.paso)?.tipo).not.toBe('dos')
  })

  it('1 foto: una sola a todo lo ancho, sin recortarla más del 15 %', () => {
    const plan = planDeFichas([[1.365]], ANCHO)
    const d = plan.fichas[0]!
    expect(d).toEqual({ tipo: 'una', fotos: [0] })
    expect(recorte(1.365, ANCHO / plan.altoMm)).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
  })

  it('todas las fichas del documento del mismo alto: una con 1 foto y otra con 3 van las dos a una sola foto ancha', () => {
    // Como la COT-2026-0008: un hotel con una sola foto buena manda el alto; el de 3 cabe con una.
    const plan = planDeFichas([[1.365], [1.389], [1.417, 1.385, 1.389]], ANCHO)
    expect(plan.fichas.map((d) => d?.tipo)).toEqual(['una', 'una', 'una'])
    expect(plan.altoMm).toBeGreaterThanOrEqual(55)
    expect(plan.altoMm).toBeLessThanOrEqual(ALTO_FOTO_FICHA_MM.maximo)
  })

  it('una foto que necesitaría recortarse más no se usa; si es la única, la ficha va sin foto', () => {
    // Una cuadrada sola pediría un recuadro de más de 70 mm.
    expect(planDeFichas([[1]], ANCHO).fichas).toEqual([null])
    // Con otra, se queda la que cabe en la distribución que le sirve.
    const plan = planDeFichas([[1, 1.5]], ANCHO)
    expect(plan.fichas[0]?.fotos.length).toBeGreaterThan(0)
    for (const d of plan.fichas) for (const r of recortes([1, 1.5], d!, plan.altoMm)) expect(r).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
  })

  it('ninguna foto de ningún plan se recorta más del 15 %', () => {
    const casos = [
      [[1.5, 1.33, 1.78], [1.5]],
      [[1.33, 1.33, 1.33], [1.5, 1.5], [1.78]],
      [[2, 1.5, 1.5]],
      [[1.877, 1.499, 1.499], [1.798, 1.746, 1]],
      [[0.8, 1.8]],
    ]
    for (const fichas of casos) {
      const plan = planDeFichas(fichas, ANCHO)
      plan.fichas.forEach((d, i) => {
        if (!d) return
        for (const r of recortes(fichas[i], d, plan.altoMm)) expect(r).toBeLessThanOrEqual(RECORTE_MAXIMO + 1e-9)
      })
    }
  })

  it('sin fotos: el alto de siempre y ninguna distribución', () => {
    expect(planDeFichas([[], []], ANCHO)).toEqual({ altoMm: 25, fichas: [null, null] })
  })
})
