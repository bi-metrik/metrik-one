import { describe, expect, it } from 'vitest'
import { aMayusculas, mayusculasDeBloqueDeViaje } from './mayusculas'

/** El bloque «Condiciones del viaje» de Trappvel, recortado a lo que decide. */
const CONDICIONES_DEL_VIAJE = [
  { slug: 'destino', tipo: 'texto' },
  { slug: 'fecha_salida', tipo: 'fecha' },
  { slug: 'adultos', tipo: 'numero' },
  { slug: 'ninos', tipo: 'numero' },
  { slug: 'infantes', tipo: 'numero' },
  { slug: 'composicion', tipo: 'select' },
  { slug: 'requisitos_especiales', tipo: 'texto' },
]

/** Un bloque de otro workspace: texto libre, sin composición de viaje. */
const OTRO_BLOQUE = [
  { slug: 'proveedor_prerreserva', tipo: 'texto' },
  { slug: 'valor_pagado', tipo: 'numero' },
]

describe('aMayusculas', () => {
  it('conserva las tildes y la Ñ', () => {
    expect(aMayusculas('cartagena de indias')).toBe('CARTAGENA DE INDIAS')
    expect(aMayusculas('canción')).toBe('CANCIÓN')
    expect(aMayusculas('niño de brazos')).toBe('NIÑO DE BRAZOS')
    expect(aMayusculas('españa, 7 días')).toBe('ESPAÑA, 7 DÍAS')
  })

  it('un correo se devuelve tal cual', () => {
    expect(aMayusculas('ana.perez@trappvel.com')).toBe('ana.perez@trappvel.com')
  })

  it('el vacío y la ausencia dan cadena vacía', () => {
    expect(aMayusculas('')).toBe('')
    expect(aMayusculas(null)).toBe('')
    expect(aMayusculas(undefined)).toBe('')
  })
})

describe('mayusculasDeBloqueDeViaje', () => {
  it('sube los campos de texto del bloque que captura el viaje', () => {
    const r = mayusculasDeBloqueDeViaje(CONDICIONES_DEL_VIAJE, {
      destino: 'punta cana',
      requisitos_especiales: 'silla de ruedas y dieta sin gluten',
    })
    expect(r.destino).toBe('PUNTA CANA')
    expect(r.requisitos_especiales).toBe('SILLA DE RUEDAS Y DIETA SIN GLUTEN')
  })

  it('no toca números, fechas ni selectores', () => {
    const r = mayusculasDeBloqueDeViaje(CONDICIONES_DEL_VIAJE, {
      destino: 'medellín',
      fecha_salida: '2026-12-24',
      adultos: 2,
      composicion: 'familia_con_ninos',
    })
    expect(r.fecha_salida).toBe('2026-12-24')
    expect(r.adultos).toBe(2)
    expect(r.composicion).toBe('familia_con_ninos')
  })

  it('un bloque que NO declara la composición se queda igual', () => {
    const data = { proveedor_prerreserva: 'copa airlines' }
    expect(mayusculasDeBloqueDeViaje(OTRO_BLOQUE, data)).toEqual(data)
  })

  it('una config ausente o mal formada no rompe ni convierte nada', () => {
    const data = { destino: 'roma' }
    expect(mayusculasDeBloqueDeViaje(undefined, data)).toEqual(data)
    expect(mayusculasDeBloqueDeViaje(null, data)).toEqual(data)
    expect(mayusculasDeBloqueDeViaje([null, 'adultos', { slug: 3 }], data)).toEqual(data)
  })

  it('no inventa claves que el dato no traía', () => {
    const r = mayusculasDeBloqueDeViaje(CONDICIONES_DEL_VIAJE, { destino: 'lima' })
    expect(Object.keys(r)).toEqual(['destino'])
  })
})
