import { describe, expect, it } from 'vitest'

import { aplicarCorrecciones, camposCorregibles, CAMPOS_DE_COSTO, esCorregible, leerCorrecciones, leidosPorSlug } from './correcciones'
import { ranuraPorSlug } from './ranuras-pantallazo'

const HOTEL = ranuraPorSlug('hotel_detalle')!
const VUELO = ranuraPorSlug('vuelo_detalle')!

describe('qué se corrige en la ficha', () => {
  it('lo descriptivo sí; lo que entra al costo no (se corrige en rubros, pasajeros o margen)', () => {
    const hotel = camposCorregibles(HOTEL).map(c => c.slug)
    expect(hotel).toContain('estrellas')
    expect(hotel).toContain('regimen')
    expect(hotel).toContain('check_in')
    for (const s of ['moneda', 'precio_total', 'base_precio', 'total_a_pagar_agencia', 'ocupacion_adultos']) {
      expect(hotel).not.toContain(s)
    }
    expect(esCorregible(VUELO, 'hora_salida')).toBe(true)
    expect(esCorregible(VUELO, 'equipaje_bodega')).toBe(true)
    expect(esCorregible(VUELO, 'pax')).toBe(false)
  })

  it('todo campo de costo que nombra la lista existe en alguna ranura (la lista no se queda vieja)', () => {
    const todos = ['vuelo_detalle', 'hotel_detalle', 'actividad_detalle', 'traslado_detalle']
      .flatMap(s => ranuraPorSlug(s)!.campos.map(c => c.slug))
    for (const s of CAMPOS_DE_COSTO) expect(todos).toContain(s)
  })
})

describe('lo corregido encima de lo leído', () => {
  const leido = { regimen: 'Todo incluido', hotel: 'Decameron', estrellas: '3' }

  it('una corrección reemplaza; una corrección vacía BORRA lo leído; lo demás queda', () => {
    const d = aplicarCorrecciones(leido, {
      regimen: { valor: 'Solo alojamiento', por: 'Daniela', porId: 'p1', en: '2026-09-22T20:00:00Z' },
      estrellas: { valor: null, por: 'Daniela', porId: 'p1', en: '2026-09-22T20:00:00Z' },
    })
    expect(d).toEqual({ regimen: 'Solo alojamiento', hotel: 'Decameron' })
    // Lo leído no se toca.
    expect(leido.regimen).toBe('Todo incluido')
  })

  it('sin correcciones es lo leído tal cual', () => {
    expect(aplicarCorrecciones(leido, undefined)).toEqual(leido)
  })

  it('leer correcciones descarta lo que no tiene forma de corrección', () => {
    expect(leerCorrecciones({
      regimen: { valor: 'SA', por: 'D', porId: 'p', en: 'x' },
      mala: { valor: 3, en: 'x' },
      sinFecha: { valor: 'a' },
      vacia: { valor: null, en: 'x' },
    })).toEqual({
      regimen: { valor: 'SA', por: 'D', porId: 'p', en: 'x' },
      vacia: { valor: null, por: null, porId: null, en: 'x' },
    })
    expect(leerCorrecciones([1, 2])).toEqual({})
    expect(leerCorrecciones(null)).toEqual({})
  })

  it('lo leído vuelve a sus slugs, sin el marcador «(del viaje)»', () => {
    expect(leidosPorSlug(HOTEL, [
      { label: 'Hotel', valor: 'Decameron' },
      { label: 'Check-in', valor: '2026-12-12 (del viaje)' },
      { label: 'Etiqueta que no existe', valor: 'x' },
    ])).toEqual({ hotel: 'Decameron', check_in: '2026-12-12' })
  })
})
