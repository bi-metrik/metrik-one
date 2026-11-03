import { describe, expect, it, vi } from 'vitest'

import {
  RegistroDePaquetes,
  casillaDesdeDeteccion,
  casillaParaPegado,
  destinoDelPegado,
  type EstadoDePaquete,
} from './bloqueo-pegado'

/**
 * A dónde va un pantallazo pegado en una cotización de bloqueo (QA del 2026-10-29). El caso real: el
 * vuelo de COT-2026-0007, sin precio, pegado con Ctrl+V fuera de la casilla.
 */

const paquete = (itemId: string, x: Partial<EstadoDePaquete> = {}): EstadoDePaquete => ({ itemId, abierto: true, hotelLleno: false, vueloLleno: false, ...x })

describe('destino del pegado', () => {
  it('un paquete abierto con el hotel ya pegado: el pegado va a su VUELO', () => {
    expect(destinoDelPegado([paquete('p1', { hotelLleno: true })], null)).toEqual({ a: 'paquete', itemId: 'p1', casilla: 'vuelo' })
  })
  it('con el vuelo y sin hotel: al hotel', () => {
    expect(destinoDelPegado([paquete('p1', { vueloLleno: true })], null)).toEqual({ a: 'paquete', itemId: 'p1', casilla: 'hotel' })
  })
  it('las dos casillas vacías (o llenas): la decide la detección', () => {
    expect(destinoDelPegado([paquete('p1')], null)).toEqual({ a: 'paquete', itemId: 'p1', casilla: null })
    expect(casillaParaPegado({ hotelLleno: true, vueloLleno: true })).toBeNull()
  })
  it('varios abiertos: el último que se tocó; sin ninguno tocado, se pregunta', () => {
    const dos = [paquete('p1'), paquete('p2', { hotelLleno: true })]
    expect(destinoDelPegado(dos, 'p2')).toEqual({ a: 'paquete', itemId: 'p2', casilla: 'vuelo' })
    expect(destinoDelPegado(dos, null)).toEqual({ a: 'elegir' })
  })
  it('sin paquete abierto: la bandeja ofrece elegir', () => {
    expect(destinoDelPegado([paquete('p1', { abierto: false })], 'p1')).toEqual({ a: 'elegir' })
    expect(destinoDelPegado([], null)).toEqual({ a: 'elegir' })
  })
  it('la detección: vuelo → vuelo (aunque no traiga precio); hotel o paquete → hotel; lo demás se pregunta', () => {
    expect(casillaDesdeDeteccion('vuelo')).toBe('vuelo')
    expect(casillaDesdeDeteccion('hotel')).toBe('hotel')
    expect(casillaDesdeDeteccion('paquete')).toBe('hotel')
    expect(casillaDesdeDeteccion('actividad')).toBeNull()
    expect(casillaDesdeDeteccion(null)).toBeNull()
  })
})

describe('el registro entre la bandeja y las tarjetas', () => {
  it('entrega a la tarjeta montada, y lo que llega a una sin montar espera en su buzón', () => {
    const r = new RegistroDePaquetes()
    const recibir = vi.fn()
    const baja = r.registrar('p1', { estado: () => paquete('p1', { hotelLleno: true }), recibir })
    expect(r.destino()).toEqual({ a: 'paquete', itemId: 'p1', casilla: 'vuelo' })
    expect(r.entregar('p1', 'data:image/png;base64,AAA', 'vuelo')).toBe(true)
    expect(recibir).toHaveBeenCalledWith('data:image/png;base64,AAA', 'vuelo')

    expect(r.entregar('p2', 'data:image/png;base64,BBB', null)).toBe(false)
    const recibir2 = vi.fn()
    r.registrar('p2', { estado: () => paquete('p2'), recibir: recibir2 })
    expect(recibir2).toHaveBeenCalledWith('data:image/png;base64,BBB', null)

    baja()
    expect(r.estados().map(e => e.itemId)).toEqual(['p2'])
  })
})
