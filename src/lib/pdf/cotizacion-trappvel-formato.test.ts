/**
 * Las reglas de forma del documento de Trappvel (sistema visual del 2026-09-22), sin
 * pintar nada. Lo que el documento IMPRIME lo prueba `cotizacion-trappvel-render.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import {
  TOKENS,
  absorberRedondeo,
  capitulosDelViaje,
  clienteDeLaPortada,
  colorDeTarifa,
  leerFecha,
  lugarLegible,
  numerosDeVuelo,
  rangoCompacto,
  siglaAerolinea,
  tituloConAcento,
  vueloDesdeNombre,
  yaEstaEnElTitulo,
  type FilaPorPasajeroDoc,
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
    expect(numerosDeVuelo('AV8520 / AV9380', true)).toEqual({ ida: 'AV8520', regreso: 'AV9380', sinAsignar: null })
  })

  /**
   * ⚠️ COT-2026-0006 (2026-09-22): la lectura de SATENA guardó `8832 · 8833` y el documento
   * imprimió los dos en la fila de la ida, con el regreso sin vuelo. El `·` no era
   * separador, así que el texto no se dejaba partir y caía entero en la ida.
   */
  it('⚠️ COT-2026-0006: «8832 · 8833» y «9782, 9779» se reparten ida y regreso', () => {
    expect(numerosDeVuelo('8832 · 8833', true)).toEqual({ ida: '8832', regreso: '8833', sinAsignar: null })
    expect(numerosDeVuelo('9782, 9779', true)).toEqual({ ida: '9782', regreso: '9779', sinAsignar: null })
  })

  it('con el código de la aerolínea separado por espacio, cada número sigue siendo uno', () => {
    expect(numerosDeVuelo('AV 8520 / AV 9380', true)).toEqual({ ida: 'AV8520', regreso: 'AV9380', sinAsignar: null })
  })

  it('con cuatro tramos, mitad y mitad', () => {
    expect(numerosDeVuelo('AV1 AV2 AV3 AV4', true)).toEqual({ ida: 'AV1 · AV2', regreso: 'AV3 · AV4', sinAsignar: null })
    expect(numerosDeVuelo('9459 · 4867 · 9842 · 9488', true)).toEqual({ ida: '9459 · 4867', regreso: '9842 · 9488', sinAsignar: null })
  })

  it('⚠️ sin forma de saber cuál es de cuál, no se pega a ningún tramo: va sin asignar', () => {
    // Impar: no se sabe dónde parte.
    expect(numerosDeVuelo('AV1 AV2 AV3', true)).toEqual({ ida: null, regreso: null, sinAsignar: 'AV1 · AV2 · AV3' })
    // Uno solo para un viaje de ida y regreso: puede ser de cualquiera de los dos.
    expect(numerosDeVuelo('8832', true)).toEqual({ ida: null, regreso: null, sinAsignar: '8832' })
    // Un texto que no es una lista de números no se parte ni se reescribe.
    expect(numerosDeVuelo('ver reserva', true)).toEqual({ ida: null, regreso: null, sinAsignar: 'ver reserva' })
  })

  it('sin regreso todo es de la ida, y sin dato no hay número', () => {
    expect(numerosDeVuelo('AV8520 AV9380', false)).toEqual({ ida: 'AV8520 · AV9380', regreso: null, sinAsignar: null })
    expect(numerosDeVuelo('', true)).toEqual({ ida: null, regreso: null, sinAsignar: null })
    expect(numerosDeVuelo(null, true)).toEqual({ ida: null, regreso: null, sinAsignar: null })
  })
})

describe('lo que el nombre de la línea dice del vuelo', () => {
  it('«AVIANCA BOG - ADZ»: la aerolínea como se escribió y la ruta en IATA', () => {
    expect(vueloDesdeNombre('AVIANCA BOG - ADZ')).toEqual({ aerolinea: 'AVIANCA', origen: 'BOG', destino: 'ADZ' })
    expect(vueloDesdeNombre('AVIANCA BOG - ADZ (alternativa)')).toEqual({ aerolinea: 'AVIANCA', origen: 'BOG', destino: 'ADZ' })
    expect(vueloDesdeNombre('Copa PTY → BOG')).toEqual({ aerolinea: 'Copa', origen: 'PTY', destino: 'BOG' })
  })

  it('sin dos códigos IATA no hay ruta, y sin ruta no se adivina la aerolínea', () => {
    // «PROVIDENCIA» no es un código: el resto del nombre no es el de una aerolínea.
    expect(vueloDesdeNombre('SATENA ADZ - PROVIDENCIA')).toEqual({ aerolinea: null, origen: null, destino: null })
    // En minúscula no cuenta: «bog-adz» puede ser cualquier cosa.
    expect(vueloDesdeNombre('avianca bog - adz')).toEqual({ aerolinea: null, origen: null, destino: null })
    expect(vueloDesdeNombre(null)).toEqual({ aerolinea: null, origen: null, destino: null })
  })

  it('con ruta pero sin una aerolínea conocida, la ruta sale y la aerolínea no', () => {
    expect(vueloDesdeNombre('TRASLADO APT - HTL')).toEqual({ aerolinea: null, origen: 'APT', destino: 'HTL' })
  })
})

describe('el redondeo del precio por pasajero', () => {
  // COT-2026-0006: 6 adultos a 1.651.969 (el reparto exacto daba 9.911.816), niño e infante.
  const FILAS: FilaPorPasajeroDoc[] = [
    { tipo: 'adulto', cantidad: 6, precioUnitario: 1_651_969 },
    { tipo: 'nino', cantidad: 1, precioUnitario: 1_238_558 },
    { tipo: 'infante', cantidad: 1, precioUnitario: 26_676 },
  ]
  const suma = (f: FilaPorPasajeroDoc[]) => f.reduce((a, x) => a + x.precioUnitario * (x.cantidad ?? 0), 0)

  it('⚠️⚠️ COT-2026-0006: los 2 pesos se absorben y la columna suma el TOTAL', () => {
    const r = absorberRedondeo(FILAS, 2)
    expect(r.residuo).toBe(0)
    expect(suma(r.filas)).toBe(11_177_050)
    // Van a la fila de un solo pasajero con mayor subtotal: el niño. El adulto no se toca
    // porque 2 no se reparte entero entre 6.
    expect(r.filas.map(f => f.precioUnitario)).toEqual([1_651_969, 1_238_560, 26_676])
  })

  it('un residuo que se reparte entero entre los de una fila va a esa fila', () => {
    const r = absorberRedondeo([{ tipo: 'adulto', cantidad: 3, precioUnitario: 100 }, { tipo: 'nino', cantidad: 2, precioUnitario: 50 }], 3)
    expect(r).toEqual({ filas: [{ tipo: 'adulto', cantidad: 3, precioUnitario: 101 }, { tipo: 'nino', cantidad: 2, precioUnitario: 50 }], residuo: 0 })
  })

  it('un residuo negativo también se absorbe', () => {
    const r = absorberRedondeo(FILAS, -2)
    expect(suma(r.filas)).toBe(11_177_050 - 4)
    expect(r.residuo).toBe(0)
  })

  it('si ninguna fila lo absorbe entero, lo devuelve intacto para nombrarlo', () => {
    const filas = [{ tipo: 'adulto' as const, cantidad: 6, precioUnitario: 100 }, { tipo: 'nino' as const, cantidad: 2, precioUnitario: 50 }]
    expect(absorberRedondeo(filas, 1)).toEqual({ filas, residuo: 1 })
  })

  it('sin residuo no toca nada', () => {
    expect(absorberRedondeo(FILAS, 0)).toEqual({ filas: FILAS, residuo: 0 })
  })
})

describe('el cliente bajo el título de la portada', () => {
  it('⚠️ persona natural: contacto y empresa son el mismo nombre y sale UNA vez', () => {
    expect(clienteDeLaPortada('Ligia Sanchez', 'Ligia Sanchez')).toBe('Ligia Sanchez')
    // Sin distinguir tildes, mayúsculas ni espacios de más.
    expect(clienteDeLaPortada('LIGIA  SÁNCHEZ', 'Ligia Sanchez')).toBe('LIGIA  SÁNCHEZ')
  })

  it('con empresa y contacto distintos salen los dos, como siempre', () => {
    expect(clienteDeLaPortada('Ana Pérez', 'Viajes Andinos SAS')).toBe('Ana Pérez · Viajes Andinos SAS')
  })

  it('con uno solo sale ese, y sin ninguno no sale nada', () => {
    expect(clienteDeLaPortada(null, 'Viajes Andinos SAS')).toBe('Viajes Andinos SAS')
    expect(clienteDeLaPortada('Ana Pérez', '  ')).toBe('Ana Pérez')
    expect(clienteDeLaPortada(null, null)).toBeNull()
  })
})

describe('el nombre del capítulo contra el título de la portada', () => {
  it('ya está dicho si el título lo nombra entero, sin importar tildes ni puntuación', () => {
    expect(yaEstaEnElTitulo('San Andrés - Providencia', 'San Andrés - Providencia')).toBe(true)
    expect(yaEstaEnElTitulo('Cancun', 'Viaje a Cancún · familia Sánchez')).toBe(true)
  })

  it('no lo está si el título no lo nombra, o solo lo contiene dentro de otra palabra', () => {
    expect(yaEstaEnElTitulo('Cartagena', 'Luna de miel Pérez')).toBe(false)
    expect(yaEstaEnElTitulo('Roma', 'Romería en Boyacá')).toBe(false)
    expect(yaEstaEnElTitulo(null, 'San Andrés')).toBe(false)
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
