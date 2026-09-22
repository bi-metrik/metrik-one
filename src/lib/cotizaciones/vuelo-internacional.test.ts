import { describe, expect, it } from 'vitest'

import { alcanceDelVuelo, dondeQueda } from './vuelo-internacional'

/**
 * «Internacional» = origen o destino fuera de Colombia; lo que no se reconoce cuenta
 * como internacional y se avisa.
 *
 * Los textos de entrada son los que la lectura del pantallazo dejó en las líneas de
 * Trappvel (medido el 2026-09-22), no formas inventadas: solo código, ciudad y código,
 * solo ciudad.
 */

describe('dónde queda un lugar leído', () => {
  it.each([
    ['CUC', 'colombia'],
    ['AXM', 'colombia'],
    ['Bogotá BOG', 'colombia'],
    ['San Andrés Isla ADZ', 'colombia'],
    ['Providencia PVA', 'colombia'],
    ['Bogotá', 'colombia'],
    ['San Andrés Isla', 'colombia'],
    ['Orlando MCO', 'exterior'],
    ['Cancún CUN', 'exterior'],
    ['Cancún', 'exterior'],
    ['Ciudad de México (MEX)', 'exterior'],
  ])('%s → %s', (texto, esperado) => {
    expect(dondeQueda(texto).donde).toBe(esperado)
  })

  it('en mayúsculas, una palabra de tres letras del nombre no se toma por código', () => {
    // «SAN» es San Diego. Si se leyera como código, este vuelo nacional saldría
    // internacional por una palabra del nombre de la isla.
    expect(dondeQueda('SAN ANDRÉS ISLA ADZ').donde).toBe('colombia')
  })

  it('«Cali» es Colombia, «California» no', () => {
    expect(dondeQueda('Cali').donde).toBe('colombia')
    expect(dondeQueda('California').donde).toBe('desconocido')
  })

  it('un nombre ambiguo sin código no se da por colombiano', () => {
    // Armenia (Quindío) y Armenia (el país); Florencia (Caquetá) y Florencia (Italia).
    // Tomarlos por nacionales le quitaría el recargo a un viaje que sí lo lleva.
    expect(dondeQueda('Armenia').donde).toBe('desconocido')
    expect(dondeQueda('Florencia').donde).toBe('desconocido')
    // Con su código sí se reconocen.
    expect(dondeQueda('Armenia AXM').donde).toBe('colombia')
  })

  it('un código que no está en ninguna lista NO se reconoce', () => {
    // El caso que la regla protege: una lectura que trajo BOQ en vez de BOG.
    expect(dondeQueda('BOQ').donde).toBe('desconocido')
  })

  it('vacío o ausente no se reconoce', () => {
    expect(dondeQueda('').donde).toBe('desconocido')
    expect(dondeQueda(null).donde).toBe('desconocido')
  })

  it('con un código de cada lado, gana el del exterior: la duda ofrece, no quita', () => {
    expect(dondeQueda('BOG - MIA').donde).toBe('exterior')
  })
})

describe('alcance de un vuelo', () => {
  it('Bogotá – San Andrés es nacional', () => {
    expect(alcanceDelVuelo('Bogotá BOG', 'San Andrés Isla ADZ')).toEqual({ internacional: false, sinReconocer: [] })
  })

  it('Bogotá – Cancún es internacional', () => {
    expect(alcanceDelVuelo('Bogotá BOG', 'Cancún CUN')).toEqual({ internacional: true, sinReconocer: [] })
  })

  it('basta con UN lado fuera de Colombia', () => {
    expect(alcanceDelVuelo('Orlando MCO', 'Bogotá').internacional).toBe(true)
  })

  it('un lado que no se reconoce cuenta como internacional y se nombra', () => {
    expect(alcanceDelVuelo('Bogotá BOG', 'BOQ')).toEqual({ internacional: true, sinReconocer: ['BOQ'] })
  })

  it('sin lectura: internacional, y dice qué falta', () => {
    expect(alcanceDelVuelo(null, null)).toEqual({
      internacional: true,
      sinReconocer: ['sin origen', 'sin destino'],
    })
  })
})
