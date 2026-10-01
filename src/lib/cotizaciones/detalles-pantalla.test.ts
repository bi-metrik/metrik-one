/**
 * Las reglas puras detrás de los detalles de pantalla de Trappvel (brief del 2026-10-01).
 * El recorrido por el editor está en `detalles-pantalla-e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { estadoDeBloque } from './bandeja-capturas'
import { hotelesDeItems } from './detalle-viaje'
import { repartirHabitaciones, tarifaConHabitaciones } from './habitaciones'
import { crudaDeHotelManual, lecturaManual, leerHotelManual, montoConMiles, type HotelManual } from './ingreso-manual'
import { nombreVisibleDeLinea } from './nombre-visible'
import { ranuraPorSlug } from './ranuras-pantallazo'
import { avisoDePasajeros, avisoDePasajerosDeOpcion, resumenDeAlojamiento } from './tarjeta-opcion'
import type { Composicion, Habitacion, LecturaCasilla } from './tarifa-pasajero'
import { aMayusculas } from '@/lib/negocios/mayusculas'

const HOTEL = ranuraPorSlug('hotel_detalle')!
const TRASLADO = ranuraPorSlug('traslado_detalle')!
const GRUPO: Composicion = { adultos: 2, ninos: 0, infantes: 1 }

function habitacion(over: Partial<HotelManual> = {}): LecturaCasilla {
  const r = lecturaManual({
    ranura: HOTEL,
    entrada: {
      tipo: 'hotel',
      datos: {
        hotel: 'PRUEBA Posada del Mar', ciudad: 'Providencia', entrada: '2026-11-09', salida: '2026-11-13',
        habitacion: 'Doble estándar', regimen: 'Desayuno y cena', incluye: '', adultos: 1, ninos: 0, infantes: 0,
        netoAdulto: 100_000, netoNino: null, netoInfante: null, edadDesde: null, edadHasta: null,
        fuente: 'Telefónico', ...over,
      },
    },
    leidaEn: '2026-10-01T15:00:00Z',
    hoy: '2026-10-01',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}
const fija = (h: Habitacion, valor: 'habitacion' | 'referencia'): Habitacion =>
  ({ ...h, rolManual: { valor, por: 'Alejandra', porId: null, en: '2026-10-01T15:00:00Z' } })

const R1: Habitacion = { id: 'r1', lectura: habitacion() }
const R2: Habitacion = { id: 'r2', lectura: habitacion({ infantes: 1, netoInfante: 0 }) }
const R3: Habitacion = { id: 'r3', lectura: habitacion({ netoAdulto: 120_000 }) }

describe('punto 1 · el aviso de pasajeros, con las mismas palabras en la tarjeta y en el bloque', () => {
  it('falta: «Faltan 1 adulto y 1 infante: pega su habitación.»', () => {
    const r = resumenDeAlojamiento(repartirHabitaciones([R1], GRUPO))
    expect(avisoDePasajeros(r)).toEqual({ corto: 'Faltan 1 adulto y 1 infante', frase: 'Faltan 1 adulto y 1 infante: pega su habitación.' })
  })

  it('el bloque con una opción a la que le faltan pasajeros NO está completo, y explica con la frase de la tarjeta', () => {
    const tarifa = tarifaConHabitaciones({}, [R1], GRUPO)
    const pasajeros = avisoDePasajerosDeOpcion(tarifa, GRUPO)
    const e = estadoDeBloque({ grupo: 'hotel', etiqueta: 'Hotel en Providencia' }, [
      { id: 'i1', nombre: 'PRUEBA POSADA DEL MAR', conCosto: true, sinConfirmar: false, alerta: null, pasajeros },
    ])
    expect(e.completo).toBe(false)
    expect(e.motivo).toBe('PRUEBA POSADA DEL MAR: faltan 1 adulto y 1 infante')
    expect(e.aviso).toBe('Faltan pasajeros')
    expect(e.explicacion).toBe('PRUEBA POSADA DEL MAR · Faltan 1 adulto y 1 infante: pega su habitación.')
    expect(e.opcionId).toBe('i1')
  })

  it('cubierto el grupo, completo como antes', () => {
    const tarifa = tarifaConHabitaciones({}, [R1, R2], GRUPO)
    expect(avisoDePasajerosDeOpcion(tarifa, GRUPO)).toBeNull()
    const e = estadoDeBloque({ grupo: 'hotel', etiqueta: 'Hotel' }, [
      { nombre: 'X', conCosto: true, sinConfirmar: false, alerta: null, pasajeros: null },
    ])
    expect(e.completo).toBe(true)
  })
})

describe('punto 2 · la habitación de referencia se ve, y la elección manda', () => {
  it('ONE propone de referencia la que sobra; el resumen la cuenta aparte', () => {
    const r = resumenDeAlojamiento(repartirHabitaciones([R1, R2, R3], GRUPO))
    expect(r.titulo).toBe('2 habitaciones · cubre a los 3 viajeros · 1 de referencia, no suma')
    expect(r.referencias).toBe(1)
    expect(avisoDePasajeros(r)).toBeNull()
  })

  it('elegidas de más: «Sobra 1 adulto», con qué hacer', () => {
    const r = resumenDeAlojamiento(repartirHabitaciones([fija(R1, 'habitacion'), fija(R2, 'habitacion'), fija(R3, 'habitacion')], GRUPO))
    expect(r.titulo).toBe('3 habitaciones · sobra 1 adulto')
    expect(avisoDePasajeros(r)?.frase).toBe('Sobra 1 adulto: marca «No va» en la habitación que no va.')
    expect(r.cupos.find(c => c.texto.includes('adulto'))).toEqual({ texto: '3/2 adultos', falta: true })
  })

  it('el documento: si la única que va no es la primera captura, la acomodación es la suya', () => {
    const conDosQueNoVan = tarifaConHabitaciones({}, [fija(R1, 'referencia'), fija({ id: 'r4', lectura: habitacion({ adultos: 2, infantes: 1, netoInfante: 0 }) }, 'habitacion')], GRUPO)
    const [h] = hotelesDeItems([{ nombre: 'X', grupo: 'hotel', tarifa_pax: conDosQueNoVan, adicionales: [] }])
    expect(h.ocupacion).toBe('2 adultos, 1 infante')
  })
})

describe('punto 4 · el nombre visible de hotel y traslado', () => {
  const traslado = (() => {
    const r = lecturaManual({
      ranura: TRASLADO,
      entrada: {
        tipo: 'traslado',
        datos: {
          ruta: 'Aeropuerto - hotel', fecha: '2026-11-09', adultos: 2, ninos: 0, infantes: 1, cobro: 'por_persona',
          precio: 'por_trayecto', neto: 45_000, netoNino: null, netoInfante: null, idaYRegreso: true, fuente: 'Dolphins',
        },
      },
      leidaEn: '2026-10-01T15:00:00Z',
      hoy: '2026-10-01',
    })
    if (!r.ok) throw new Error('lectura')
    return r.lectura
  })()

  it('el nombre que ONE escribió en mayúscula se muestra como se leyó', () => {
    const item = { nombre: aMayusculas(traslado.nombre), grupo: 'traslado', tarifa_pax: { casillas: { grupo_completo: traslado } } }
    expect(item.nombre).toBe('AEROPUERTO - HOTEL (IDA Y REGRESO)')
    expect(nombreVisibleDeLinea(item)).toBe('Aeropuerto - hotel (ida y regreso)')
    const hotel = tarifaConHabitaciones({}, [R1, R2], GRUPO)
    expect(nombreVisibleDeLinea({ nombre: 'PRUEBA POSADA DEL MAR · PROVIDENCIA', grupo: 'hotel', tarifa_pax: hotel })).toBe('PRUEBA Posada del Mar · Providencia')
  })

  it('un nombre que escribió una persona, un vuelo o una línea sin lectura no cambian', () => {
    const tarifa = { casillas: { grupo_completo: traslado } }
    expect(nombreVisibleDeLinea({ nombre: 'TRASLADO VIP', grupo: 'traslado', tarifa_pax: tarifa })).toBe('TRASLADO VIP')
    expect(nombreVisibleDeLinea({ nombre: 'AVIANCA BOG-ADZ', grupo: 'vuelo', tarifa_pax: {} })).toBe('AVIANCA BOG-ADZ')
    expect(nombreVisibleDeLinea({ nombre: 'Diseño ', grupo: null, tarifa_pax: null })).toBe('Diseño ')
    expect(nombreVisibleDeLinea({ nombre: null, grupo: 'traslado', tarifa_pax: tarifa })).toBe('')
  })
})

describe('punto 7 · los montos con separador de miles', () => {
  it('al escribir se ve con punto de miles', () => {
    expect(montoConMiles('280000')).toBe('280.000')
    expect(montoConMiles('1234567')).toBe('1.234.567')
    expect(montoConMiles('280.0001')).toBe('2.800.001')
    expect(montoConMiles('$ 45000')).toBe('45.000')
    expect(montoConMiles('0')).toBe('0')
    expect(montoConMiles('007')).toBe('7')
    expect(montoConMiles('')).toBe('')
    expect(montoConMiles('abc')).toBe('')
  })

  it('se guarda el número: «280.000» cuesta lo mismo que «280000»', () => {
    const datos = { hotel: 'X', habitacion: 'Doble', entrada: '2026-11-09', salida: '2026-11-13', adultos: 2, ninos: 0, infantes: 1, fuente: 'F' }
    const conPunto = leerHotelManual({ ...datos, netoAdulto: '280.000', netoInfante: '0' })
    const sinPunto = leerHotelManual({ ...datos, netoAdulto: '280000', netoInfante: '0' })
    expect(conPunto.netoAdulto).toBe(280_000)
    expect(crudaDeHotelManual(conPunto).totalGeneral).toBe(2_240_000)
    expect(crudaDeHotelManual(conPunto)).toEqual(crudaDeHotelManual(sinPunto))
  })
})
