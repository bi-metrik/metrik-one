/**
 * H4 · D5 (verificación D de Vera, 2026-10-14): al quitar SATENA, el párrafo que habla de SATENA
 * queda marcado; el que habla de Providencia (que sigue con su hotel) no.
 */
import { describe, expect, it } from 'vitest'

import type { DocumentoCliente, ViajeParaRedactar } from './documento-cliente'
import { nombresDelViaje, parrafosViejos, textoDeParrafoViejo } from './parrafo-viejo'

const VIAJE: ViajeParaRedactar = {
  destino: 'San Andrés y Providencia', fechaSalida: '2026-11-23', fechaRegreso: '2026-11-28', duracion: '5 noches',
  viajeros: { adultos: 6, ninos: 1, infantes: 1 },
  vuelos: [
    { aerolinea: 'Avianca', desde: 'Bogotá', hasta: 'San Andrés', fechaIda: null, fechaRegreso: null, escalaIda: null, escalaRegreso: null, directo: true, tarifa: null, equipaje: null, adicionales: [] },
    { aerolinea: 'SATENA', desde: 'San Andrés', hasta: 'Providencia', fechaIda: null, fechaRegreso: null, escalaIda: null, escalaRegreso: null, directo: true, tarifa: null, equipaje: null, adicionales: [] },
  ],
  hoteles: [
    { nombre: 'Posada Enilda', ciudad: 'Providencia', estrellas: null, entrada: null, salida: null, noches: 2, regimen: null, habitacion: null, adicionales: [] },
    { nombre: 'Verde Mar', ciudad: 'San Andrés', estrellas: null, entrada: null, salida: null, noches: 3, regimen: null, habitacion: null, adicionales: [] },
  ],
  traslados: ['Aeropuerto - hotel - aeropuerto Providencia (23 nov)'],
  actividades: ['Tour Cayo Cangrejo · Lancha compartida (24 nov)'],
  otrosServicios: [],
  cargosEnDestino: [],
}

const SIN_SATENA: ViajeParaRedactar = { ...VIAJE, vuelos: VIAJE.vuelos.filter(v => v.aerolinea !== 'SATENA') }

function doc(t: Partial<DocumentoCliente>): DocumentoCliente {
  return {
    titular: 'San Andrés y Providencia, el Caribe colombiano',
    intro: 'Seis noches entre dos islas: llegan a San Andrés con Avianca y saltan a Providencia en SATENA.',
    incluye: [],
    antes_de_viajar: ['Lleven la tarjeta de turismo de San Andrés.', 'El vuelo de SATENA permite 10 kg de mano.', 'En Providencia no hay cajeros: lleven efectivo.'],
    origen: 'ia', modelo: 'm', redactado_en: null, fuente_hash: 'h', revisado_por: null, revisado_por_nombre: null, revisado_en: '2026-10-14T00:00:00Z',
    fuente_nombres: nombresDelViaje(VIAJE),
    ...t,
  }
}

describe('H4 · D5 · el párrafo viejo', () => {
  it('los nombres del viaje: hoteles, aerolíneas, actividades y traslados, sin la fecha', () => {
    expect(nombresDelViaje(VIAJE)).toEqual([
      'Posada Enilda', 'Verde Mar', 'Avianca', 'SATENA', 'Tour Cayo Cangrejo · Lancha compartida', 'Aeropuerto - hotel - aeropuerto Providencia',
    ])
  })

  it('quitar SATENA marca la presentación y el renglón que la nombran, y no el de Providencia', () => {
    const p = parrafosViejos(doc({}), nombresDelViaje(SIN_SATENA))
    expect(p).toEqual([
      { zona: 'intro', indice: null, nombres: ['SATENA'] },
      { zona: 'antes', indice: 1, nombres: ['SATENA'] },
    ])
    expect(textoDeParrafoViejo(p[0])).toBe('Habla de SATENA, que ya no va en la cotización.')
  })

  it('si no sale ningún servicio (cambió solo un precio), nada se marca', () => {
    expect(parrafosViejos(doc({}), nombresDelViaje(VIAJE))).toEqual([])
  })

  it('un texto sin los nombres guardados (escrito antes, o con la pantalla de siempre) no marca nada', () => {
    expect(parrafosViejos(doc({ fuente_nombres: undefined }), nombresDelViaje(SIN_SATENA))).toEqual([])
  })
})
