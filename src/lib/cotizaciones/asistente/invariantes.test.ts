import { describe, expect, it } from 'vitest'
import type { BorradorCotizacion, HotelBorrador } from './borrador'
import { totalDelHotel, validarBorrador } from './invariantes'

const hotel = (over: Partial<HotelBorrador>): HotelBorrador => ({
  pantallazo: 2, version: 'Recomendada', nombreEnPantallazo: 'Mar Azul', nombre: 'Hotel Mar Azul',
  zonaEnPantallazo: 'Zona NORTE 2027', zona: 'Zona Norte', noches: 3, habitacion: 'Doble estándar',
  regimenEnPantallazo: '(P.A.M.) Desayuno y Cena', regimen: 'Desayuno y cena', temporada: null, codigoTarifa: null,
  compraAntesDe: null, tipoTarifa: 'publica',
  precios: [{ acomodacion: 'Doble', personasPorHabitacion: 2, precioPorPersona: 1_000_001 }, { acomodacion: 'Sencilla', personasPorHabitacion: 1, precioPorPersona: 1_500_000 }],
  ninos: [{ rango: 'CHD 2-11 años', precio: 400_000 }],
  distribucion: [{ acomodacion: 'Doble', habitaciones: 1, personasPorHabitacion: 2 }],
  ninosAsignados: [], totalCalculadoPorElModelo: 2_000_002, incluyeIconos: [], incluye: 'Vuelo ida y regreso con Aerolínea Ficticia',
  cajaFoto: null, ...over,
})

const borrador = (hoteles: HotelBorrador[], over: Partial<BorradorCotizacion> = {}): BorradorCotizacion => ({
  clienteParaDocumento: 'Ana Prueba', titular: 'Isla Ficticia', intro: '', destino: 'Isla Ficticia',
  vuelos: [
    { aerolinea: 'Ficticia', numero: 'FF101', origenIata: 'AAA', origenCiudad: 'A', destinoIata: 'BBB', destinoCiudad: 'B', fecha: '2027-02-01', salida: '08:00', llegada: '10:00', escalas: 0 },
    { aerolinea: 'Ficticia', numero: 'FF102', origenIata: 'BBB', origenCiudad: 'B', destinoIata: 'AAA', destinoCiudad: 'A', fecha: '2027-02-04', salida: '18:00', llegada: '20:00', escalas: 0 },
  ],
  hoteles, incluye: [], noIncluye: [], antesDeViajar: [], dudas: [], ...over,
})

const viajeros = { adultos: 2, ninos: [] }
const errores = (b: BorradorCotizacion, v = viajeros) => validarBorrador(b, v).hallazgos.filter(h => h.nivel === 'error').map(h => h.mensaje)

describe('invariantes del borrador', () => {
  it('el total es precio por persona × personas, al peso', () => {
    expect(totalDelHotel(hotel({}))).toBe(2_000_002)
    expect(validarBorrador(borrador([hotel({})]), viajeros).totales.Recomendada).toBe(2_000_002)
  })

  it('suma varias acomodaciones y niños', () => {
    const h = hotel({
      distribucion: [{ acomodacion: 'Doble', habitaciones: 1, personasPorHabitacion: 2 }, { acomodacion: 'Sencilla', habitaciones: 1, personasPorHabitacion: 1 }],
      ninosAsignados: [{ rango: 'CHD 2-11 años', cantidad: 1 }],
    })
    expect(totalDelHotel(h)).toBe(2_000_002 + 1_500_000 + 400_000)
  })

  it('manda el total del código cuando el modelo sumó mal, y lo avisa', () => {
    const v = validarBorrador(borrador([hotel({ totalCalculadoPorElModelo: 2_000_000 })]), viajeros)
    expect(v.totales.Recomendada).toBe(2_000_002)
    expect(v.hallazgos.some(h => h.nivel === 'aviso' && /manda el del código/.test(h.mensaje))).toBe(true)
  })

  it('error si la gente no cabe o la acomodación no existe', () => {
    expect(errores(borrador([hotel({})]), { adultos: 3, ninos: [] }).join()).toMatch(/acomoda 2 adultos/)
    expect(errores(borrador([hotel({ distribucion: [{ acomodacion: 'Triple', habitaciones: 1, personasPorHabitacion: 2 }] })])).join()).toMatch(/no está en la tabla/)
  })

  it('error si las noches del hotel no son las del vuelo', () => {
    expect(errores(borrador([hotel({ noches: 4 })])).join()).toMatch(/4 noches y el vuelo da 3/)
  })

  it('error si el regreso no es después de la ida', () => {
    const b = borrador([hotel({})])
    b.vuelos[1].fecha = '2027-01-30'
    expect(errores(b).join()).toMatch(/no es después de la ida/)
  })

  it('tarifa sin saber si es pública o neta exige una pregunta abierta', () => {
    expect(errores(borrador([hotel({ tipoTarifa: 'desconocida' })])).join()).toMatch(/pública o neta/)
    const conDuda = borrador([hotel({ tipoTarifa: 'desconocida' })], { dudas: [{ campo: 'tarifa', pregunta: '¿Es tarifa neta?', queSePusoMientras: 'pública', bloquea: true }] })
    expect(errores(conDuda)).toEqual([])
  })

  it('dos hoteles en la misma versión, o sin Recomendada, es error', () => {
    expect(errores(borrador([hotel({}), hotel({ pantallazo: 3 })])).join()).toMatch(/Dos hoteles/)
    expect(errores(borrador([hotel({ version: 'Económica' })])).join()).toMatch(/No hay versión Recomendada/)
  })
})
