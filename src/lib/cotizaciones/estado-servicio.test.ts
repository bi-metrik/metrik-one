/** C3 · el estado del servicio (Incluido · Opcional · No va), puro. */
import { describe, expect, it } from 'vitest'

import { cambiosDeEstado, estadoDeLinea, estadoDelServicio, estadosPermitidos } from './estado-servicio'
import { fueraDelPrecio, puedeSerSugerido } from './dia-relativo'

describe('C3 · qué estados admite cada tipo', () => {
  it('vuelo y hotel: Incluido · No va; traslado y actividad: también Opcional', () => {
    expect(estadosPermitidos('vuelo 2: SAI')).toEqual(['incluido', 'no'])
    expect(estadosPermitidos('hotel: Hotel en Providencia')).toEqual(['incluido', 'no'])
    expect(estadosPermitidos('traslado 2: Traslado en San Andrés')).toEqual(['incluido', 'opcional', 'no'])
    expect(estadosPermitidos('actividad: Cayo Cangrejo')).toEqual(['incluido', 'opcional', 'no'])
    expect(estadosPermitidos(null)).toEqual([])
    expect(estadosPermitidos('seguro')).toEqual([])
  })
})

describe('C3 · leer y escribir el estado con los dos interruptores de siempre', () => {
  it('un vuelo o un hotel fuera del precio es «No va» aunque una marca vieja lo muestre', () => {
    expect(estadoDeLinea({ grupo: 'hotel', entra_al_precio: false, mostrar_en_sugeridos: true })).toBe('no')
    expect(estadoDeLinea({ grupo: 'traslado', entra_al_precio: false, mostrar_en_sugeridos: true })).toBe('opcional')
    expect(estadoDeLinea({ grupo: 'traslado', entra_al_precio: null })).toBe('incluido')
  })

  it('el traslado Opcional queda fuera del precio y sugerido, como una actividad opcional', () => {
    const c = cambiosDeEstado({ grupo: 'traslado', entra_al_precio: true, mostrar_en_sugeridos: true }, 'opcional')!
    expect(c).toEqual({ entra_al_precio: false, mostrar_en_sugeridos: true, noVa: null })
    const linea = { id: 't', grupo: 'traslado', es_ajuste: false, dia_relativo: null, entra_al_precio: c.entra_al_precio }
    expect(fueraDelPrecio(linea)).toBe(true)
    expect(puedeSerSugerido(linea)).toBe(true)
  })

  it('el hotel que no va queda fuera del precio y NO sugerido', () => {
    const c = cambiosDeEstado({ grupo: 'hotel', entra_al_precio: true }, 'no')!
    expect(c).toEqual({ entra_al_precio: false, mostrar_en_sugeridos: false, noVa: { era: 'incluida' } })
    const linea = { id: 'h', grupo: 'hotel', es_ajuste: false, dia_relativo: null, entra_al_precio: false }
    expect(fueraDelPrecio(linea)).toBe(true)
    expect(puedeSerSugerido(linea)).toBe(false)
  })

  it('«No va» recuerda si era Opcional; ya así, no hay nada que escribir', () => {
    expect(cambiosDeEstado({ grupo: 'actividad', entra_al_precio: false, mostrar_en_sugeridos: true }, 'no')?.noVa).toEqual({ era: 'opcional' })
    expect(cambiosDeEstado({ grupo: 'actividad', entra_al_precio: true }, 'incluido')).toBeNull()
  })

  it('el estado del servicio es el de su primera opción por orden', () => {
    expect(estadoDelServicio([
      { orden: 2, grupo: 'traslado', entra_al_precio: true },
      { orden: 1, grupo: 'traslado', entra_al_precio: false, mostrar_en_sugeridos: true },
    ])).toBe('opcional')
    expect(estadoDelServicio([])).toBe('incluido')
  })
})
