/**
 * Un traslado por cada hotel (reunión con Trappvel del 2026-10-22, punto 5). Datos ficticios.
 */
import { describe, expect, it } from 'vitest'

import { itemsDelItinerario, itemsQueAportanAlTotal } from './itinerarios'
import { aplicarPlan, planDeTarifas, violacionDeInvariante, type EstadoDeTarifas, type TarifaDelPlan } from './tarifas-por-pasos'
import { hotelDeLinea, hotelesAsociados } from './va-con-hotel'
import { leerTarifaPax } from './tarifa-pasajero'

type Item = EstadoDeTarifas['items'][number]
const conHotel = (h: string) => ({ vaConHotel: h })

const it_ = (id: string, grupo: string | null, orden: number, costo: number, tarifa_pax: unknown = null): Item => ({
  id, grupo, orden, es_ajuste: false, dia_relativo: null, entra_al_precio: true, costo, tarifa_pax,
} as Item)

// Vuelo fijo, dos opciones de hotel y dos traslados en el mismo servicio, uno por hotel.
const VUELO = it_('vuelo', 'vuelo: Bogotá - Cancún', 1, 2_000_000)
const HOTEL_A = it_('hotel-a', 'hotel: Hotel en Cancún', 2, 1_500_000)
const HOTEL_B = it_('hotel-b', 'hotel: Hotel en Cancún', 3, 3_000_000)
const TRASLADO_A = it_('traslado-a', 'traslado: Aeropuerto - hotel', 4, 80_000, conHotel('hotel-a'))
const TRASLADO_B = it_('traslado-b', 'traslado: Aeropuerto - hotel', 5, 120_000, conHotel('hotel-b'))
const TRASLADO_GENERAL = it_('traslado-general', 'traslado: Aeropuerto - hotel', 6, 100_000)

describe('qué suma cada tarifa', () => {
  const items = [VUELO, HOTEL_A, HOTEL_B, TRASLADO_A, TRASLADO_B]

  it('dos opciones de hotel con su traslado: cada una lleva el suyo', () => {
    expect(itemsDelItinerario(items, ['hotel-a'])).toEqual(['vuelo', 'hotel-a', 'traslado-a'])
    expect(itemsDelItinerario(items, ['hotel-b'])).toEqual(['vuelo', 'hotel-b', 'traslado-b'])
  })

  it('aunque la tarifa nombre el traslado del otro hotel, no lo cobra: toma el suyo', () => {
    expect(itemsDelItinerario(items, ['hotel-a', 'traslado-b'])).toEqual(['vuelo', 'hotel-a', 'traslado-a'])
  })

  it('un traslado general (uno por zona) sirve para las dos sin cargarlo dos veces', () => {
    const conGeneral = [VUELO, HOTEL_A, HOTEL_B, { ...TRASLADO_GENERAL, grupo: 'traslado: Tours de la zona Cancún' }]
    expect(itemsDelItinerario(conGeneral, ['hotel-a'])).toEqual(['vuelo', 'hotel-a', 'traslado-general'])
    expect(itemsDelItinerario(conGeneral, ['hotel-b'])).toEqual(['vuelo', 'hotel-b', 'traslado-general'])
  })

  it('específico y general en el mismo servicio: el del hotel si lo hay; si no, el general', () => {
    const mezcla = [VUELO, HOTEL_A, HOTEL_B, TRASLADO_A, TRASLADO_GENERAL]
    expect(itemsDelItinerario(mezcla, ['hotel-a'])).toEqual(['vuelo', 'hotel-a', 'traslado-a'])
    expect(itemsDelItinerario(mezcla, ['hotel-b'])).toEqual(['vuelo', 'hotel-b', 'traslado-general'])
  })

  it('traslados en servicios distintos (cada uno solo) atados a su hotel: ya no se suman los dos', () => {
    const sueltos = [VUELO, HOTEL_A, HOTEL_B, { ...TRASLADO_A, grupo: 'traslado: Aeropuerto - Hotel A' }, { ...TRASLADO_B, grupo: 'traslado: Aeropuerto - Hotel B' }]
    expect(itemsDelItinerario(sueltos, ['hotel-a'])).toEqual(['vuelo', 'hotel-a', 'traslado-a'])
    expect(itemsDelItinerario(sueltos, ['hotel-b'])).toEqual(['vuelo', 'hotel-b', 'traslado-b'])
    // Sin tarifas, el total por supuesto toma el primer hotel y SU traslado.
    expect(itemsQueAportanAlTotal(sueltos)).toEqual(['vuelo', 'hotel-a', 'traslado-a'])
  })

  it('si la opción de hotel se borró, el traslado queda general (no desaparece de todo)', () => {
    const huerfano = [VUELO, HOTEL_A, { ...TRASLADO_B, grupo: 'traslado: solo' }]
    expect(hotelesAsociados(huerfano).size).toBe(0)
    expect(itemsDelItinerario(huerfano, [])).toEqual(['vuelo', 'hotel-a', 'traslado-b'])
  })

  it('sin asociaciones, lo de siempre: la nombrada o la primera', () => {
    const sin = [VUELO, HOTEL_A, HOTEL_B, { ...TRASLADO_A, tarifa_pax: null }, { ...TRASLADO_B, tarifa_pax: null }]
    expect(itemsDelItinerario(sin, ['hotel-a', 'traslado-b'])).toEqual(['vuelo', 'hotel-a', 'traslado-b'])
    expect(itemsDelItinerario(sin, ['hotel-b'])).toEqual(['vuelo', 'hotel-b', 'traslado-a'])
  })

  it('el dato sobrevive a `leerTarifaPax` (si no, se perdería en la siguiente escritura)', () => {
    expect(leerTarifaPax(conHotel('hotel-a')).vaConHotel).toBe('hotel-a')
    expect(hotelDeLinea({ tarifa_pax: { vaConHotel: '  ' } })).toBeNull()
  })
})

describe('el plan de las tarifas (por pasos)', () => {
  let n = 0
  const nuevoId = () => `t-${++n}`
  const costoDe = (items: Item[]) => (id: string) => items.find(i => i.id === id)?.costo ?? null
  const correr = (antes: EstadoDeTarifas | null, despues: EstadoDeTarifas): TarifaDelPlan[] =>
    aplicarPlan(despues.tarifas, planDeTarifas({ antes, despues, costoDe: costoDe(despues.items), costoAntesDe: antes ? costoDe(antes.items) : undefined }), nuevoId)
  const items = [VUELO, HOTEL_A, HOTEL_B, TRASLADO_A, TRASLADO_B]
  const traslado = (t: TarifaDelPlan) => ['traslado-a', 'traslado-b'].find(id => t.seleccion.includes(id))
  const hotel = (t: TarifaDelPlan) => ['hotel-a', 'hotel-b'].find(id => t.seleccion.includes(id))

  it('al armar las tres tarifas, cada una nombra el traslado de su hotel', () => {
    const tarifas = correr(null, { items, tarifas: [] })
    expect(violacionDeInvariante({ items, tarifas })).toBeNull()
    for (const t of tarifas) expect(traslado(t)).toBe(hotel(t) === 'hotel-a' ? 'traslado-a' : 'traslado-b')
  })

  it('cambiar el hotel de una tarifa le cambia el traslado; las otras no se tocan', () => {
    const tarifas = correr(null, { items, tarifas: [] })
    const eco = tarifas.find(t => t.nombre === 'Económica')!
    const otras = tarifas.filter(t => t !== eco).map(t => [t.id, [...t.seleccion].sort()])
    expect(hotel(eco)).toBe('hotel-a')
    // La asesora pone el Hotel B en la Económica (lo que hace `elegirOpcionEnTarifa`).
    const conB = tarifas.map(t => (t === eco ? { ...t, seleccion: [...t.seleccion.filter(id => id !== 'hotel-a'), 'hotel-b'] } : t))
    const despues = correr({ items, tarifas }, { items, tarifas: conB })
    const ecoDespues = despues.find(t => t.id === eco.id)!
    expect(traslado(ecoDespues)).toBe('traslado-b')
    expect(despues.filter(t => t.id !== eco.id).map(t => [t.id, [...t.seleccion].sort()])).toEqual(otras)
  })

  it('asociar después de armar: cada tarifa pasa a tomar el traslado de su hotel', () => {
    // El traslado del Hotel A es el más caro: sin asociar, la Económica (Hotel A) toma el más
    // barato, que es el del Hotel B.
    const costos: Record<string, number> = { 'traslado-a': 120_000, 'traslado-b': 80_000 }
    const asociados = items.map(i => (costos[i.id] ? { ...i, costo: costos[i.id] } : i))
    const sinAsociar = asociados.map(i => (i.id.startsWith('traslado') ? { ...i, tarifa_pax: null } : i))
    const tarifas = correr(null, { items: sinAsociar, tarifas: [] })
    const eco = tarifas.find(t => t.nombre === 'Económica')!
    expect([hotel(eco), traslado(eco)]).toEqual(['hotel-a', 'traslado-b'])
    const despues = correr({ items: sinAsociar, tarifas }, { items: asociados, tarifas })
    for (const t of despues) expect(traslado(t)).toBe(hotel(t) === 'hotel-a' ? 'traslado-a' : 'traslado-b')
  })

  it('asociar un traslado a un hotel lo pone en esa tarifa aunque antes llevara el general', () => {
    const general = { ...TRASLADO_GENERAL, orden: 4 }
    const especifico = { ...TRASLADO_A, orden: 5, tarifa_pax: null }
    const antes = [VUELO, HOTEL_A, HOTEL_B, general, especifico]
    const tarifas = correr(null, { items: antes, tarifas: [] })
    const rec = tarifas.find(t => t.nombre === 'Recomendada')!
    expect([hotel(rec), rec.seleccion.includes('traslado-general')]).toEqual(['hotel-a', true])
    const despues = [VUELO, HOTEL_A, HOTEL_B, general, { ...especifico, tarifa_pax: conHotel('hotel-a') }]
    const recDespues = correr({ items: antes, tarifas }, { items: despues, tarifas }).find(t => t.id === rec.id)!
    expect(recDespues.seleccion).toContain('traslado-a')
    expect(recDespues.seleccion).not.toContain('traslado-general')
  })
})
