/**
 * La ciudad de cada cosa sale de SU dato (PDF de la prueba Europa, 2026-10-14):
 *
 *  (a) el Waldorf Astoria Amsterdam salía como Premium de «Destino 1 de 4: Madrid»: el hotel cuya
 *      ciudad no se igualaba caía al PRIMER capítulo;
 *  (b) el Eurostar París→Ámsterdam quedó «Traslado en Madrid»: sin lugar del detector, el bloque
 *      tomaba la primera ciudad del destino del viaje;
 *  (c) la portada salía con «Bogotá · Monserrate»: la llegada del vuelo de regreso (AMS→BOG)
 *      contaba como ciudad del viaje.
 *
 * Datos inventados. Se vio fallar: con la caída a `capitulos[0]`, con `lugarDeBloqueNuevo`
 * devolviendo la pista sola para el traslado, y sin el filtro del origen en `fotosDelViaje`.
 */
import { describe, expect, it } from 'vitest'

import type { HotelPDF } from '@/lib/cotizaciones/detalle-viaje'
import { destinoDeItinerario } from '@/lib/cotizaciones/detalle-viaje'
import { rutaDeTraslado } from '@/lib/cotizaciones/actividad-pantallazo'
import { nombreAutomaticoDeRanura } from '@/lib/cotizaciones/ranuras-cotizacion'
import { capitulosDelViaje } from './cotizacion-trappvel-formato'
import { fotosDelViaje, origenDelViaje } from './fotos-del-viaje'
import type { FotoCiudad } from './fotos-ciudad'

const hotel = (over: Partial<HotelPDF>): HotelPDF => ({
  linea: 'HOTEL', hotel: 'Hotel', ciudad: 'Madrid', habitacion: null, regimen: null, checkIn: null, checkOut: null,
  noches: null, ocupacion: null, cancelacion: null, estrellas: null, localizador: null, adicionales: [], ...over,
})

describe('(a) cada hotel va al capítulo de SU ciudad, no al primero', () => {
  const madrid = hotel({ hotel: 'Catalonia', ciudad: 'Madrid', checkIn: '2026-12-11', checkOut: '2026-12-14', tarifas: [1] })
  const amsterdam = hotel({ hotel: 'NH Centre', ciudad: 'Ámsterdam', checkIn: '2026-12-24', checkOut: '2026-12-28', tarifas: [1] })

  it('la ciudad escrita dentro de un texto más largo («Dam Square, Amsterdam») cuenta', () => {
    const waldorf = hotel({ hotel: 'Waldorf Astoria', ciudad: 'Herengracht 542, Amsterdam, Países Bajos', tarifas: [2] })
    const caps = capitulosDelViaje([madrid, amsterdam, waldorf], 1, null)
    expect(caps.map(c => c.ciudad)).toEqual(['Madrid', 'Ámsterdam'])
    expect(caps[0].alternativas).toEqual([])
    expect(caps[1].alternativas.map(h => h.hotel)).toEqual(['Waldorf Astoria'])
  })

  it('sin ciudad, mandan sus fechas: entra el día que entra el hotel de Ámsterdam', () => {
    const waldorf = hotel({ hotel: 'Waldorf Astoria', ciudad: null, checkIn: '2026-12-24', checkOut: '2026-12-28', tarifas: [2] })
    const caps = capitulosDelViaje([madrid, amsterdam, waldorf], 1, null)
    expect(caps[1].alternativas.map(h => h.hotel)).toEqual(['Waldorf Astoria'])
    expect(caps[0].alternativas).toEqual([])
  })

  it('una ciudad que la principal no tiene abre su propio capítulo, no se mete en Madrid', () => {
    const lisboa = hotel({ hotel: 'Pestana', ciudad: 'Lisboa', checkIn: '2026-12-30', tarifas: [2] })
    const caps = capitulosDelViaje([madrid, amsterdam, lisboa], 1, null)
    expect(caps.map(c => c.ciudad)).toEqual(['Madrid', 'Ámsterdam', 'Lisboa'])
    expect(caps[2]).toMatchObject({ hotel: null, alternativas: [{ hotel: 'Pestana' }] })
  })
})

describe('(b) un tren o traslado entre ciudades se nombra con su trayecto', () => {
  it('«París - Ámsterdam (solo ida)» → «Traslado París–Ámsterdam»', () => {
    const ruta = rutaDeTraslado('París - Ámsterdam (solo ida)')
    expect(ruta).toBe('París–Ámsterdam')
    expect(nombreAutomaticoDeRanura({ tipo: 'traslado', lugar: ruta })).toBe('Traslado París–Ámsterdam')
    expect(rutaDeTraslado('Paris Nord → Amsterdam Centraal')).toBe('Paris Nord–Amsterdam Centraal')
  })

  it('el de aeropuerto a hotel no dice la ciudad: no se inventa una', () => {
    expect(rutaDeTraslado('Aeropuerto Barajas - Hotel Catalonia')).toBeNull()
    expect(rutaDeTraslado('Traslado privado')).toBeNull()
    // El hotel sigue con su «en».
    expect(nombreAutomaticoDeRanura({ tipo: 'traslado', lugar: 'Madrid' })).toBe('Traslado en Madrid')
  })
})

describe('(c) la ciudad de salida del cliente no es destino del documento', () => {
  const ida = { destino: 'Madrid MAD', origen: 'Bogotá BOG', fechaSalida: '2026-12-10' }
  const regreso = { destino: 'Bogotá BOG', origen: 'Ámsterdam AMS', fechaSalida: '2026-12-28' }

  it('el origen es el del primer vuelo por fecha, aunque el regreso venga primero en la lista', () => {
    expect(origenDelViaje([regreso, ida])).toBe('Bogotá BOG')
  })

  it('el destino armado del itinerario no nombra Bogotá', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const destino = destinoDeItinerario([ida, regreso] as any, [hotel({ ciudad: 'Madrid' }), hotel({ ciudad: 'Ámsterdam' })])
    expect(destino).toContain('Ámsterdam')
    expect(destino).not.toContain('Bogotá')
  })

  it('la portada y las fotos no salen de la ciudad de salida', () => {
    const banco: Record<string, FotoCiudad> = {
      bogota: { ciudad: 'bogota', ruta: '/bogota.jpg', rotulo: 'BOGOTÁ · MONSERRATE', autor: 'x', licencia: 'x', credito: 'x', foco: { x: 0.5, y: 0.5 }, proporcion: 1.5 } as FotoCiudad,
    }
    const buscar = (c: string) => (/bogot|bog\b/i.test(c) ? [banco.bogota] : [])
    const fotos = fotosDelViaje({ destino: 'Madrid · Bogotá BOG', vuelos: [ida, regreso], hoteles: [{ ciudad: 'Madrid' }] }, buscar)
    expect(fotos.portada).toBeNull()
    expect(fotos.ciudades).toEqual([])
  })
})
