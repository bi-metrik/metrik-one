/** El motivo para no enviar cuando una línea sin costo entra al total (Mauricio, 2026-09-23). */
import { describe, expect, it } from 'vitest'

import { motivoFaltaCosto, nombreDeLineaSinCosto } from './falta-costo'

describe('la línea sin costo, nombrada como se lee', () => {
  it('ranura con nombre y opción de relleno: «Vuelo a Providencia · Opción 1»', () => {
    expect(nombreDeLineaSinCosto({ grupo: 'vuelo 3: Vuelo a Providencia', nombre: 'OPCIÓN 1' })).toBe('Vuelo a Providencia · Opción 1')
  })
  it('un nombre real se deja tal cual; sin grupo, solo el nombre', () => {
    expect(nombreDeLineaSinCosto({ grupo: 'hotel: Hotel en Cancún', nombre: 'RIU PALACE' })).toBe('Hotel en Cancún · RIU PALACE')
    expect(nombreDeLineaSinCosto({ grupo: null, nombre: 'TRASLADO' })).toBe('TRASLADO')
  })
})

describe('el motivo', () => {
  it('nada que decir sin líneas', () => {
    expect(motivoFaltaCosto([])).toBeNull()
  })
  it('una línea: el texto de la decisión', () => {
    expect(motivoFaltaCosto([{ grupo: 'vuelo 3: Vuelo a Providencia', nombre: 'OPCIÓN 1' }])).toBe(
      'Falta el costo de Vuelo a Providencia · Opción 1: el cliente recibiría un precio sin ese servicio.',
    )
  })
  it('dos o más: las dos primeras y «N más», en plural', () => {
    const tres = [{ grupo: null, nombre: 'A' }, { grupo: null, nombre: 'B' }, { grupo: null, nombre: 'C' }]
    expect(motivoFaltaCosto(tres.slice(0, 2))).toBe('Falta el costo de A y B: el cliente recibiría un precio sin esos servicios.')
    expect(motivoFaltaCosto(tres)).toBe('Falta el costo de A, B y 1 más: el cliente recibiría un precio sin esos servicios.')
  })
})

describe('cuando lo que falta es la tasa de cambio (brief del 2026-10-05)', () => {
  const TASA = 'El precio está en EUR: escribe la tasa de cambio para cargar el costo.'
  const actividad = { id: 'a', grupo: 'actividad: Actividad en Providencia', nombre: 'Opción 1' }
  it('una línea: el motivo de siempre y el texto de la tarjeta, tal cual', () => {
    expect(motivoFaltaCosto([actividad], new Map([['a', TASA]]))).toBe(
      `Falta el costo de Actividad en Providencia · Opción 1: el cliente recibiría un precio sin ese servicio. ${TASA}`,
    )
  })
  it('varias: cada tasa con su línea; las que no esperan tasa no agregan nada', () => {
    const vuelo = { id: 'v', grupo: 'vuelo 3: Vuelo a Providencia', nombre: 'OPCIÓN 1' }
    expect(motivoFaltaCosto([vuelo, actividad], new Map([['a', TASA]]))).toBe(
      'Falta el costo de Vuelo a Providencia · Opción 1 y Actividad en Providencia · Opción 1: el cliente recibiría un precio sin esos servicios. ' +
      `Actividad en Providencia · Opción 1: ${TASA}`,
    )
  })
  it('sin tasas pendientes (o sin el mapa, como lo arma el servidor), el motivo de siempre', () => {
    expect(motivoFaltaCosto([actividad], new Map())).toBe('Falta el costo de Actividad en Providencia · Opción 1: el cliente recibiría un precio sin ese servicio.')
    expect(motivoFaltaCosto([actividad])).toBe('Falta el costo de Actividad en Providencia · Opción 1: el cliente recibiría un precio sin ese servicio.')
  })
})
