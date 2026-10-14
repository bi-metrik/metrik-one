/**
 * H14 de la prueba Europa (2026-10-14): con el grupo (2 adultos, 1 niño, 1 infante) ya cubierto
 * por la captura del grupo completo, las capturas de la RESTA del mismo hotel y fechas («2
 * adultos + 1 niño», «2 adultos») entraban como habitaciones 2 y 3 y SUMABAN: el hotel se cobraba
 * tres veces.
 *
 * Regla: mientras lo cubierto pase del grupo, una captura cuya ocupación cabe en la de otra
 * habitación es de referencia (no suma), y al pegarla se pregunta (`sobraLaCaptura`): nunca suma
 * en silencio. Dos habitaciones de verdad (R8) siguen sumando. Cifras inventadas.
 *
 * Se vio fallar: sin el segundo ciclo de `repartirHabitaciones`, el costo es el de las tres.
 */
import { describe, expect, it } from 'vitest'

import { repartirHabitaciones, sobraLaCaptura } from './habitaciones'
import { lecturaManual, type HotelManual } from './ingreso-manual'
import { ranuraPorSlug } from './ranuras-pantallazo'
import type { Habitacion, LecturaCasilla } from './tarifa-pasajero'

const HOTEL = ranuraPorSlug('hotel_detalle')!

function captura(over: Partial<HotelManual>): LecturaCasilla {
  const r = lecturaManual({
    ranura: HOTEL,
    entrada: {
      tipo: 'hotel',
      datos: {
        hotel: 'Hotel Prueba Gran Vía', ciudad: 'Madrid', entrada: '2026-12-11', salida: '2026-12-14',
        habitacion: 'Familiar', regimen: 'Desayuno', incluye: '', adultos: 2, ninos: 0, infantes: 0,
        netoAdulto: 200_000, netoNino: 100_000, netoInfante: 0, edadDesde: null, edadHasta: null, fuente: 'Prueba', ...over,
      },
    },
    leidaEn: '2026-10-14T15:00:00Z',
    hoy: '2026-10-14',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

const COMPLETA = captura({ adultos: 2, ninos: 1, infantes: 1 })
const SIN_INFANTE = captura({ adultos: 2, ninos: 1, infantes: 0 })
const SOLO_ADULTOS = captura({ adultos: 2 })
const GRUPO = { adultos: 2, ninos: 1, infantes: 1 }

describe('H14 · la resta de un hotel no suma como habitación', () => {
  it('con el grupo cubierto, las capturas de la resta quedan de referencia y el costo es el de una', () => {
    const habs: Habitacion[] = [
      { id: 'completa', lectura: COMPLETA },
      { id: 'sin-infante', lectura: SIN_INFANTE },
      { id: 'solo-adultos', lectura: SOLO_ADULTOS },
    ]
    const r = repartirHabitaciones(habs, GRUPO)
    expect(r.habitaciones.filter(h => h.rol === 'habitacion').map(h => h.id)).toEqual(['completa'])
    expect(r.costoTotal).toBe(r.habitaciones[0].total)
    expect(r.sobran).toBeNull()
  })

  it('pegar la resta con el grupo cubierto pregunta («sobra»), no suma en silencio', () => {
    expect(sobraLaCaptura([{ id: 'completa', lectura: COMPLETA }], SIN_INFANTE, GRUPO)).toBe(true)
  })

  it('una persona que la marca habitación a mano manda', () => {
    const habs: Habitacion[] = [
      { id: 'completa', lectura: COMPLETA },
      { id: 'sin-infante', lectura: SIN_INFANTE, rolManual: { valor: 'habitacion', por: null, porId: null, en: '2026-10-14T15:00:00Z' } },
    ]
    const r = repartirHabitaciones(habs, GRUPO)
    expect(r.habitaciones.every(h => h.rol === 'habitacion')).toBe(true)
  })

  it('dos habitaciones de verdad (4 adultos y 1 niño en 2A+1N y 2A) siguen sumando (R8)', () => {
    const habs: Habitacion[] = [
      { id: 'a', lectura: SIN_INFANTE },
      { id: 'b', lectura: SOLO_ADULTOS },
    ]
    const r = repartirHabitaciones(habs, { adultos: 4, ninos: 1, infantes: 0 })
    expect(r.habitaciones.every(h => h.rol === 'habitacion')).toBe(true)
    expect(r.faltan).toBeNull()
  })
})
