import { describe, expect, it } from 'vitest'

import { ubicarPastilla, type Caja, type RenglonPastilla } from './ubicar-pastilla'

/**
 * Dónde va la pastilla de «Lo que suma» (brief del 2026-10-16, diseño de Noor). Las cifras salen
 * del encabezado real medido en Chromium (`scripts/encabezado-pastilla.e2e.mjs`): a 1280 px el
 * renglón del viaje deja 218 px libres; a 1100 px, 38.
 */
const ANCHOS = { largo: 233, corto: 165, total: 120 }
const ALTO = 20

/** Encabezado de 1280 px: botones arriba a la derecha, título y viaje en una línea cada uno. */
function encabezado(finViaje: number, finEstado = 552) {
  const obstaculos: Caja[] = [
    { x: 264, y: 131, r: finEstado, b: 147 }, // VENTA › E2 COTIZACIÓN L1 Viaje a medida
    { x: 691, y: 134, r: 928, b: 164 }, // Avanzar de etapa · Desistir
    { x: 264, y: 172, r: 690, b: 190 }, // F 26 1 — PRUEBA · San Andrés · caso fijo
    { x: 264, y: 199, r: finViaje, b: 211 }, // la línea del viaje
  ]
  const renglones: RenglonPastilla[] = [
    { nombre: 'inicio', derecha: 928, centro: 205.5, arriba: 193.5, abajo: 222.5 },
    { nombre: 'botones', derecha: 683, centro: 149, arriba: 128, abajo: 166 },
  ]
  return { anchos: ANCHOS, alto: ALTO, renglones, obstaculos, izquierda: 264 }
}

describe('ubicarPastilla', () => {
  it('cabe entera en el renglón del viaje: «Total $X · margen Y %», centrada en él', () => {
    expect(ubicarPastilla(encabezado(600))).toEqual({ renglon: 'inicio', texto: 'largo', x: 928 - 233, y: 195.5, ancho: 233 })
  })

  it('si no cabe entera, «$X · Y %»; si tampoco, solo «$X»', () => {
    expect(ubicarPastilla(encabezado(710))).toMatchObject({ renglon: 'inicio', texto: 'corto' })
    expect(ubicarPastilla(encabezado(790))).toMatchObject({ renglon: 'inicio', texto: 'total' })
  })

  it('si ni el total cabe en su renglón, sube al de los botones, a la izquierda de ellos', () => {
    // El estado llega a 552: a la izquierda de los botones (683) cabe solo el total.
    const u = ubicarPastilla(encabezado(900))!
    expect(u).toMatchObject({ renglon: 'botones', texto: 'total' })
    expect(u.x + u.ancho).toBe(683)
  })

  it('en el renglón de los botones se corre hacia abajo para no tapar el estado, sin salir de la franja', () => {
    // El estado llega hasta 560: a la altura de los botones no cabe ni el total (563-683).
    // Como a 1100 px: el estado se parte en dos líneas y la fila mide 44 px.
    const e = encabezado(900, 560)
    e.obstaculos.push({ x: 264, y: 152, r: 380, b: 168 }) // «L1 Viaje a medida», partido abajo
    e.renglones[1] = { ...e.renglones[1], abajo: 174 }
    const u = ubicarPastilla(e)!
    expect(u).toMatchObject({ renglon: 'botones', texto: 'largo' })
    expect(u.y).toBeGreaterThanOrEqual(147 + 1)
    expect(u.y + ALTO).toBeLessThanOrEqual(174)
  })

  it('nunca baja a un renglón propio: sin hueco en ninguno de los dos, null', () => {
    const e = encabezado(900, 680)
    e.obstaculos.push({ x: 264, y: 152, r: 680, b: 166 }) // el estado ocupa las dos líneas
    expect(ubicarPastilla(e)).toBeNull()
  })

  it('no sale del encabezado por la izquierda', () => {
    const e = encabezado(900)
    expect(ubicarPastilla({ ...e, izquierda: 600, renglones: [e.renglones[1]] })).toBeNull()
  })
})
