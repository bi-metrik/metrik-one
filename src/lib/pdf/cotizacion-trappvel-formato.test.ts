/**
 * Las reglas de forma del documento de Trappvel (sistema visual del 2026-09-22), sin
 * pintar nada. Lo que el documento IMPRIME lo prueba `cotizacion-trappvel-render.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import {
  TOKENS,
  capitulosDelViaje,
  colorDeTarifa,
  leerFecha,
  lugarLegible,
  numerosDeVuelo,
  rangoCompacto,
  siglaAerolinea,
  tituloConAcento,
} from './cotizacion-trappvel-formato'
import type { HotelPDF } from '@/lib/cotizaciones/detalle-viaje'

const hotel = (over: Partial<HotelPDF>): HotelPDF => ({
  linea: 'HOTEL',
  hotel: 'Hotel',
  ciudad: 'Madrid',
  habitacion: null,
  regimen: null,
  checkIn: null,
  checkOut: null,
  noches: null,
  ocupacion: null,
  cancelacion: null,
  estrellas: null,
  localizador: null,
  adicionales: [],
  ...over,
})

describe('el color de cada tarifa', () => {
  it('la principal es magenta aunque se llame distinto', () => {
    expect(colorDeTarifa('Económica', true)).toBe(TOKENS.magenta)
  })

  it('económica es verde y premium púrpura, con o sin tilde', () => {
    expect(colorDeTarifa('Económica', false)).toBe(TOKENS.verde)
    expect(colorDeTarifa('ECONOMICA', false)).toBe(TOKENS.verde)
    expect(colorDeTarifa('Premium', false)).toBe(TOKENS.purpura)
  })

  it('un nombre que no se reconoce recibe azul, que no choca con ninguna', () => {
    expect(colorDeTarifa('Plan familiar', false)).toBe(TOKENS.azul)
  })
})

describe('la sigla de la aerolínea', () => {
  it('manda la del número de vuelo, que es un dato leído', () => {
    expect(siglaAerolinea('Aerolínea X', 'AV8520')).toBe('AV')
    expect(siglaAerolinea(null, 'LA 4072')).toBe('LA')
  })

  it('sin número, la del nombre, sin importar tildes ni mayúsculas', () => {
    expect(siglaAerolinea('SATENA', null)).toBe('9R')
    expect(siglaAerolinea('Aeroméxico', null)).toBe('AM')
  })

  it('⚠️ la clave es palabra entera: «tap» no atrapa «Tapachula»', () => {
    expect(siglaAerolinea('Vuelos Tapachula', null)).toBeNull()
  })

  it('sin forma de saberla no se inventa', () => {
    expect(siglaAerolinea('Aerolínea desconocida', null)).toBeNull()
    expect(siglaAerolinea(null, null)).toBeNull()
  })
})

describe('los números de vuelo de la ida y del regreso', () => {
  it('con dos números y regreso, el primero es la ida y el segundo el regreso', () => {
    expect(numerosDeVuelo('AV8520 / AV9380', true)).toEqual({ ida: 'AV8520', regreso: 'AV9380' })
  })

  it('con cuatro tramos, mitad y mitad', () => {
    expect(numerosDeVuelo('AV1 AV2 AV3 AV4', true)).toEqual({ ida: 'AV1 · AV2', regreso: 'AV3 · AV4' })
  })

  it('con una cantidad impar no se reparte: va entero en la ida', () => {
    expect(numerosDeVuelo('AV1 AV2 AV3', true)).toEqual({ ida: 'AV1 AV2 AV3', regreso: null })
  })

  it('sin regreso todo es de la ida, y sin dato no hay número', () => {
    expect(numerosDeVuelo('AV8520 AV9380', false)).toEqual({ ida: 'AV8520 AV9380', regreso: null })
    expect(numerosDeVuelo('', true)).toEqual({ ida: null, regreso: null })
    expect(numerosDeVuelo(null, true)).toEqual({ ida: null, regreso: null })
  })
})

describe('lugares y fechas', () => {
  it('«Bogotá BOG» se imprime «Bogotá (BOG)», y sin código queda el nombre', () => {
    expect(lugarLegible('Bogotá BOG')).toBe('Bogotá (BOG)')
    expect(lugarLegible('Providencia')).toBe('Providencia')
    expect(lugarLegible('  ')).toBeNull()
  })

  it('lee la fecha ISO y la corta de la lectura', () => {
    expect(leerFecha('2027-01-17')).toMatchObject({ dia: 17, mes: 0, anio: 2027 })
    expect(leerFecha('17 ene 2027')).toMatchObject({ dia: 17, mes: 0, anio: 2027 })
    expect(leerFecha('17 ene')).toMatchObject({ dia: 17, mes: 0 })
  })

  it('el rango es corto dentro del mismo mes y completo entre meses', () => {
    expect(rangoCompacto('17 ene 2027', '24 ene 2027')).toBe('17–24 ene')
    expect(rangoCompacto('28 ene 2027', '3 feb 2027')).toBe('28 ene – 3 feb')
  })
})

describe('el título con su acento', () => {
  it('pinta el destino si el título lo nombra, sin reescribir el texto', () => {
    expect(tituloConAcento('Viaje a Providencia - Familia Restrepo', 'Providencia')).toEqual({
      antes: 'Viaje a ',
      acento: 'Providencia',
      despues: ' - Familia Restrepo',
    })
  })

  it('encuentra el destino aunque uno tenga tilde y el otro no', () => {
    expect(tituloConAcento('Luna de miel en Cancún', 'Cancun').acento).toBe('Cancún')
  })

  it('si no lo nombra, la última palabra', () => {
    expect(tituloConAcento('Europa - Familia Restrepo', 'Madrid')).toEqual({
      antes: 'Europa - Familia ',
      acento: 'Restrepo',
      despues: '',
    })
  })
})

describe('los capítulos por ciudad', () => {
  it('un capítulo por ciudad de la tarifa principal, en su orden', () => {
    const caps = capitulosDelViaje(
      [hotel({ hotel: 'A', ciudad: 'Madrid', tarifas: [0] }), hotel({ hotel: 'B', ciudad: 'Roma', tarifas: [0] })],
      0,
      null,
    )
    expect(caps.map(c => c.ciudad)).toEqual(['Madrid', 'Roma'])
  })

  it('el hotel de otra tarifa va al capítulo de su ciudad, como alternativa', () => {
    const caps = capitulosDelViaje(
      [hotel({ hotel: 'A', ciudad: 'Madrid', tarifas: [0] }), hotel({ hotel: 'Barato', ciudad: 'Madrid', tarifas: [1] })],
      0,
      null,
    )
    expect(caps).toHaveLength(1)
    expect(caps[0].hotel?.hotel).toBe('A')
    expect(caps[0].alternativas.map(h => h.hotel)).toEqual(['Barato'])
  })

  it('sin hoteles hay un solo capítulo con el destino del negocio', () => {
    expect(capitulosDelViaje([], null, 'Providencia')).toEqual([{ ciudad: 'Providencia', hotel: null, alternativas: [] }])
  })
})
