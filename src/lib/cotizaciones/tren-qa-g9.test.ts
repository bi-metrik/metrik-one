import { describe, expect, it } from 'vitest'

import { normalizarDeteccion, rescatarCortada } from '@/lib/ai/detectar-tipo-captura'
import { filasDeServicioDeTarifa, tipoDeServicio } from '@/lib/viaje/servicios-desde-tarifa'

import { ranuraDelItem, serviciosDeItems } from './detalle-viaje'
import { estadosPermitidos } from './estado-servicio'
import { fichaDeOpcion, resumenDeOpcion } from './opcion-viaje'
import { serviciosDelDocumento } from './propuesta/servicios-del-documento'
import { nombreAutomaticoDeRanura } from './ranuras-cotizacion'
import { camposMinimos, ranuraPorSlug } from './ranuras-pantallazo'
import type { LecturaCasilla, TipoPasajero } from './tarifa-pasajero'
import { avisosDeTrayectoRepetido, mismoTrayectoEntre, vuelosParaJuntarElTren } from './trayecto-repetido'
import { ubicarLectura, vueloDelMismoTrayecto } from './ubicar-lectura'

/**
 * QA Trappvel 2026-10-29 · G9 · M9-1 (decisión 5 de Mauricio): el tipo «Tren» y el tren como
 * opción del vuelo del mismo trayecto. Lecturas del viaje 09 (COT-2026-0016), recortadas.
 */

function lectura(nombre: string, identidad: Record<string, string | null>, campos: Record<string, string>, total: number): LecturaCasilla {
  return {
    nombre,
    identidad,
    campos: Object.entries(campos).map(([label, valor]) => ({ label, valor })),
    moneda: 'EUR',
    total,
    porTipo: [{ tipo: 'adulto' as TipoPasajero, cantidad: 2, subtotal: total }],
    ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 },
  } as unknown as LecturaCasilla
}

const TREN = lectura(
  'Paris Gare de Lyon -> Roma Termini',
  { proveedor: 'Trenitalia Frecciarossa', trayecto: 'Paris Gare de Lyon -> Roma Termini', fecha_hora: '2027-07-10', hora_salida: '06:28' },
  {
    'Operador del tren': 'Trenitalia Frecciarossa',
    Trayecto: 'Paris Gare de Lyon -> Roma Termini',
    Fecha: '2027-07-10',
    'Hora de salida': '06:28',
    'Hora de llegada': '13:40',
    'Nº de tren': '9241',
    'Cambio de tren': 'Milano Centrale',
    Clase: 'Business',
  },
  474.75,
)
const AIR_FRANCE = lectura(
  'Air France París–Roma',
  { origen: 'París CDG', destino: 'Roma FCO', aerolinea: 'Air France', fecha_salida: '2027-07-10', fecha_regreso: null },
  { Aerolínea: 'Air France', Origen: 'París CDG', Destino: 'Roma FCO', Salida: '2027-07-10' },
  655,
)
const comoItem = (id: string, grupo: string, l: LecturaCasilla) => ({ id, grupo, nombre: l.nombre ?? null, tarifa_pax: { casillas: { grupo_completo: l } } })

describe('el tipo «Tren» en el catálogo y en la detección', () => {
  it('la ranura existe, con etiquetas propias que la reconocen', () => {
    const def = ranuraPorSlug('tren_detalle')
    expect(def?.label).toBe('Tren')
    expect(camposMinimos(def!).map(c => c.slug)).toEqual(expect.arrayContaining(['proveedor', 'trayecto', 'fecha_hora', 'pax']))
  })

  it('el lector de pantallazos reconoce el tren, con su ruta', () => {
    expect(normalizarDeteccion({ tipo: 'tren', origen: 'Paris Gare de Lyon', destino: 'Roma Termini', lugar: 'X' }))
      .toEqual({ tipo: 'tren', lugar: null, origen: 'Paris Gare de Lyon', destino: 'Roma Termini' })
    expect(rescatarCortada('{"tipo": "tren", "origen": "Madrid')?.tipo).toBe('tren')
  })

  it('un tren va o no va (para dejar en «No va» el que no va)', () => {
    expect(estadosPermitidos('tren: Tren París–Roma')).toEqual(['incluido', 'no'])
  })

  it('el bloque nuevo se nombra por su ruta: «Tren París–Roma»', () => {
    expect(nombreAutomaticoDeRanura({ tipo: 'tren', origen: 'París', destino: 'Roma' })).toBe('Tren París–Roma')
    expect(nombreAutomaticoDeRanura({ tipo: 'tren', lugar: 'Madrid–Barcelona' })).toBe('Tren Madrid–Barcelona')
  })
})

describe('el tren juntado como opción del vuelo sigue siendo tren', () => {
  const trenEnVuelo = comoItem('t', 'vuelo 5: Vuelo París–Roma', TREN)
  const vueloEnVuelo = comoItem('v', 'vuelo 5: Vuelo París–Roma', AIR_FRANCE)

  it('la ranura de cada opción es la que se leyó (solo entre vuelo y tren)', () => {
    expect(ranuraDelItem(trenEnVuelo)?.slug).toBe('tren_detalle')
    expect(ranuraDelItem(vueloEnVuelo)?.slug).toBe('vuelo_detalle')
    // Fuera de vuelo/tren, el grupo sigue mandando.
    expect(ranuraDelItem(comoItem('x', 'traslado: Traslado en Roma', TREN))?.slug).toBe('traslado_detalle')
  })

  it('el documento lo imprime como tren, con operador, número, cambio, clase y hora', () => {
    expect(serviciosDeItems([trenEnVuelo])).toEqual([
      { tipo: 'tren', descripcion: 'Paris Gare de Lyon -> Roma Termini · Trenitalia Frecciarossa · 9241', fecha: '10 jul 2027' },
    ])
    expect(serviciosDelDocumento([trenEnVuelo], null)).toEqual([
      { tipo: 'tren', descripcion: 'Paris Gare de Lyon - Roma Termini · Trenitalia Frecciarossa 9241 (cambio en Milano Centrale), Business', fecha: '10 jul 2027', hora: '06:28', itemId: 't' },
    ])
  })

  it('la tarjeta de la opción dice «Tren» y sus horas', () => {
    expect(resumenDeOpcion(trenEnVuelo)).toBe('Tren · Trenitalia Frecciarossa 9241 · 06:28 → 13:40 · cambio en Milano Centrale')
    expect(fichaDeOpcion(trenEnVuelo, null)).toEqual([
      'Tren · Trenitalia Frecciarossa 9241',
      '10 jul 2027 · Paris Gare de Lyon 06:28 → Roma Termini 13:40',
      'Cambio en Milano Centrale',
      'Clase: Business',
    ])
  })

  it('Reservas recibe un servicio «tren» con su operador y sus horas', () => {
    expect(tipoDeServicio(trenEnVuelo, 'vuelo')).toBe('tren')
    expect(tipoDeServicio(vueloEnVuelo, 'vuelo')).toBe('vuelo')
    const params = { margen: 0, descuento: 0 } as unknown as Parameters<typeof filasDeServicioDeTarifa>[0]['params']
    const item = { ...trenEnVuelo, es_ajuste: false, orden: 1, dia_relativo: null, entra_al_precio: true, opcion_de: null, cantidad: 1, subtotal: 2_136_375, numeroDeRubros: 0, costoDeRubros: 0, descuento_porcentaje: 0, margen_porcentaje: 0, precio_venta: null, precio_manual: null, adicionales: [], pasajeros: null }
    const [fila] = filasDeServicioDeTarifa({ items: [item as never], seleccion: null, params, tipoRanuraPorItem: { t: 'vuelo' } })
    expect(fila).toMatchObject({ tipo: 'tren', proveedor_nombre: 'Trenitalia Frecciarossa', fecha_servicio: '2027-07-10', hora_inicio: '06:28', hora_fin: '13:40' })
  })
})

describe('juntar el tren con el vuelo del mismo trayecto (menú y bandeja)', () => {
  const opciones = new Map([
    ['t', comoItem('t', 'tren: Tren París–Roma', TREN)],
    ['v', comoItem('v', 'vuelo 5: Vuelo París–Roma', AIR_FRANCE)],
    ['m', comoItem('m', 'vuelo 4: Vuelo Madrid–París', lectura('Iberia', { origen: 'MAD', destino: 'ORY', aerolinea: 'Iberia', fecha_salida: '2027-07-06' }, { Aerolínea: 'Iberia', Origen: 'MAD', Destino: 'ORY', Salida: '2027-07-06' }, 456))],
  ])
  const tren = { grupo: 'tren: Tren París–Roma', tipo: 'tren', nombre: 'Tren París–Roma', opciones: ['t'], estado: 'incluido' }
  const vuelo = { grupo: 'vuelo 5: Vuelo París–Roma', tipo: 'vuelo', nombre: 'Vuelo París–Roma', opciones: ['v'], estado: 'incluido' }
  const otroVuelo = { grupo: 'vuelo 4: Vuelo Madrid–París', tipo: 'vuelo', nombre: 'Vuelo Madrid–París', opciones: ['m'], estado: 'incluido' }

  it('«Juntar como opción de…» del tren ofrece solo el vuelo del mismo trayecto y día', () => {
    expect(vuelosParaJuntarElTren(tren, [tren, vuelo, otroVuelo], id => opciones.get(id)).map(s => s.grupo)).toEqual(['vuelo 5: Vuelo París–Roma'])
    // Desde el vuelo no se ofrece el tren: el tren entra al vuelo, no al revés.
    expect(vuelosParaJuntarElTren(vuelo, [tren, vuelo, otroVuelo], id => opciones.get(id))).toEqual([])
    expect(mismoTrayectoEntre(tren, otroVuelo, id => opciones.get(id))).toBe(false)
  })

  it('separados, el aviso dice que se cobran los dos y cómo juntarlos', () => {
    const avisos = avisosDeTrayectoRepetido([tren, vuelo], id => opciones.get(id))
    expect(avisos.get(tren.grupo)).toMatch(/Junta el tren como opción del vuelo/)
  })

  it('la bandeja propone el tren como opción del vuelo del mismo trayecto', () => {
    const lineas = [opciones.get('v')!, opciones.get('m')!]
    expect(vueloDelMismoTrayecto(TREN, lineas)).toBe('vuelo 5: Vuelo París–Roma')
    expect(ubicarLectura({ tipo: 'tren', lectura: TREN, pistas: { lugar: null, origen: 'Paris Gare de Lyon', destino: 'Roma Termini' }, lineas, grupoViaje: null }))
      .toEqual({ como: 'hermana', grupo: 'vuelo 5: Vuelo París–Roma' })
    // Otro día: bloque propio.
    const otroDia = lectura('x', { ...TREN.identidad, fecha_hora: '2027-07-11' }, {}, 1)
    expect(ubicarLectura({ tipo: 'tren', lectura: otroDia, pistas: { lugar: null, origen: null, destino: null }, lineas, grupoViaje: null }))
      .toEqual({ como: 'nueva' })
  })
})
