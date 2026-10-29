import { describe, expect, it } from 'vitest'

import type { HotelPDF, VueloPDF } from './detalle-viaje'
import { hotelesConFechasDelViaje, rangoDelViajeCotizado } from './fechas-del-viaje'

const vuelo = (extra: Partial<VueloPDF> = {}): VueloPDF => ({
  linea: 'VUELO', aerolinea: 'Aerolínea Ficticia', origen: 'BOG', destino: 'CUR',
  fechaSalida: '26 jun 2027', fechaRegreso: '30 jun 2027',
  horaSalida: '07:25', horaLlegada: '10:20', horaSalidaRegreso: '18:15', horaLlegadaRegreso: '19:10',
  escalaIda: null, escalaRegreso: null, escalas: 0, tarifa: null, equipaje: null, adicionales: [],
  ...extra,
})

const hotel = (extra: Partial<HotelPDF> = {}): HotelPDF => ({
  linea: 'HOTEL', hotel: 'Hotel Ficticio', ciudad: 'Willemstad', habitacion: null, regimen: null,
  checkIn: '21 jun 2027', checkOut: '4 jul 2027', noches: 13, ocupacion: null, cancelacion: null,
  estrellas: null, localizador: null, adicionales: [], fechasDelViaje: true,
  ...extra,
})

const solicitud = { inicio: '2027-06-21', fin: '2027-07-04' }

describe('rangoDelViajeCotizado', () => {
  it('con vuelo de ida y regreso: del día de salida al de regreso', () => {
    const r = rangoDelViajeCotizado({ vuelos: [vuelo()], hoteles: [hotel()] }, solicitud)
    expect(r).toEqual({ inicio: '2027-06-26', fin: '2027-06-30', estadia: { entrada: '2027-06-26', salida: '2027-06-30' }, fuente: 'servicios' })
  })

  it('el vuelo que llega al día siguiente: el hotel entra el día que llega', () => {
    const r = rangoDelViajeCotizado({ vuelos: [vuelo({ horaSalida: '23:40', horaLlegada: '05:10' })], hoteles: [] }, solicitud)
    expect(r.inicio).toBe('2027-06-26')
    expect(r.estadia).toEqual({ entrada: '2027-06-27', salida: '2027-06-30' })
  })

  it('sin servicios fechados: el rango de la solicitud', () => {
    const r = rangoDelViajeCotizado({ vuelos: [], hoteles: [hotel()] }, solicitud)
    expect(r).toEqual({ inicio: '2027-06-21', fin: '2027-07-04', estadia: null, fuente: 'solicitud' })
  })

  it('sin vuelo, con hoteles de fechas leídas: de la primera entrada a la última salida', () => {
    const r = rangoDelViajeCotizado({
      vuelos: [],
      hoteles: [
        hotel({ fechasDelViaje: undefined, checkIn: '27 jun 2027', checkOut: '29 jun 2027' }),
        hotel({ fechasDelViaje: undefined, checkIn: '29 jun 2027', checkOut: '2 jul 2027' }),
      ],
    }, solicitud)
    expect([r.inicio, r.fin, r.estadia]).toEqual(['2027-06-27', '2027-07-02', null])
  })

  it('solo ida: empieza con el vuelo y termina cuando dice la solicitud', () => {
    const r = rangoDelViajeCotizado({ vuelos: [vuelo({ fechaRegreso: null, horaSalidaRegreso: null, horaLlegadaRegreso: null })], hoteles: [] }, solicitud)
    expect([r.inicio, r.fin, r.estadia]).toEqual(['2027-06-26', '2027-07-04', null])
  })
})

describe('hotelesConFechasDelViaje', () => {
  it('solo cambia los hoteles con las fechas de la solicitud', () => {
    const r = rangoDelViajeCotizado({ vuelos: [vuelo()], hoteles: [] }, solicitud)
    const [delViaje, leido] = hotelesConFechasDelViaje(
      [hotel(), hotel({ fechasDelViaje: undefined, checkIn: '27 jun 2027', checkOut: '29 jun 2027', noches: 2 })],
      r,
    )
    expect([delViaje.checkIn, delViaje.checkOut, delViaje.noches]).toEqual(['26 jun 2027', '30 jun 2027', 4])
    expect([leido.checkIn, leido.checkOut, leido.noches]).toEqual(['27 jun 2027', '29 jun 2027', 2])
  })

  it('sin vuelo de ida y regreso no toca nada', () => {
    const r = rangoDelViajeCotizado({ vuelos: [], hoteles: [] }, solicitud)
    const hs = [hotel()]
    expect(hotelesConFechasDelViaje(hs, r)).toBe(hs)
  })
})
