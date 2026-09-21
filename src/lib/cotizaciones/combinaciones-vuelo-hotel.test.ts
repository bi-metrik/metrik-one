import { describe, it, expect } from 'vitest'

import {
  itemsDelItinerario,
  itemsQueAportanAlTotal,
  itinerarioCompleto,
  ranurasConAlternativas,
  ranurasCombinables,
  ranurasNoCombinables,
  ranurasPorSupuesto,
  ranurasSinResolver,
  cascadaDeItinerario,
} from './itinerarios'
import { grupoCombinable, RANURAS_COMBINABLES } from './ranuras-pantallazo'

/**
 * Regla 1 de la reunión del 2026-09-14: **las combinaciones solo cruzan vuelos y
 * hoteles.**
 *
 * El caso del encargo, tal cual: tres vuelos, tres hoteles y DOS traslados con
 * alternativas. Antes eran 3 × 3 × 2 = 18 filas, dieciocho idénticas de a pares.
 * Ahora son 9, y el traslado sigue sumando en las nueve.
 *
 * ## Por qué el control vive dentro de la prueba
 *
 * `ranurasConAlternativas` sigue viendo las TRES ranuras —el traslado no dejó de
 * tener alternativas, dejó de cruzarse— así que el producto que habría salido antes
 * se puede reconstruir aquí y comparar contra el que sale hoy. Sin ese control, un 9
 * es un número suelto: podría venir de que la prueba armó mal el caso.
 */

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    grupo: null as string | null,
    opcion_de: null as string | null,
    es_ajuste: false,
    orden: 0,
    cantidad: 1,
    subtotal: 0,
    numeroDeRubros: 0,
    costoDeRubros: 0,
    precio_venta: 0,
    precio_manual: false,
    margen_porcentaje: null as number | null,
    ...extra,
  }
}

/** El producto cartesiano de TODAS las ranuras: lo que la tabla hacía antes. */
function productoDeTodas(items: Parameters<typeof ranurasConAlternativas>[0]): number {
  return ranurasConAlternativas(items).reduce((n, r) => n * r.candidatos.length, 1)
}

// Tres vuelos, tres hoteles, dos traslados. Costos redondos para que el total se
// pueda sumar a mano al leer la prueba.
const VIAJE = [
  item('vuelo-avianca', { grupo: 'vuelo', orden: 1, subtotal: 2_000_000 }),
  item('vuelo-wingo', { grupo: 'vuelo', orden: 2, subtotal: 1_800_000, opcion_de: 'vuelo-avianca' }),
  item('vuelo-latam', { grupo: 'vuelo', orden: 3, subtotal: 1_900_000, opcion_de: 'vuelo-avianca' }),
  item('hotel-occ', { grupo: 'hotel', orden: 4, subtotal: 1_000_000 }),
  item('hotel-hr', { grupo: 'hotel', orden: 5, subtotal: 1_200_000, opcion_de: 'hotel-occ' }),
  item('hotel-par', { grupo: 'hotel', orden: 6, subtotal: 1_500_000, opcion_de: 'hotel-occ' }),
  item('traslado-priv', { grupo: 'traslado', orden: 7, subtotal: 300_000 }),
  item('traslado-comp', { grupo: 'traslado', orden: 8, subtotal: 150_000, opcion_de: 'traslado-priv' }),
]

describe('solo vuelo y hotel abren columna', () => {
  it('CONTROL · si el traslado abriera columna, las combinaciones se duplicarían', () => {
    // El argumento de la reunión del 2026-09-14, contado en números: un traslado al
    // aeropuerto no cambia según la aerolínea, así que multiplicar por él da 18 filas
    // idénticas de a pares en vez de 9.
    expect(productoDeTodas(VIAJE)).toBe(18)
  })

  it('las columnas son vuelo y hotel; el traslado queda en la otra lista', () => {
    expect(ranurasCombinables(VIAJE).map(r => r.grupo)).toEqual(['vuelo', 'hotel'])
    expect(ranurasNoCombinables(VIAJE).map(r => r.grupo)).toEqual(['traslado'])
  })
})

describe('el traslado sigue sumando: una vez, en todos los itinerarios', () => {
  const seleccion = ['vuelo-wingo', 'hotel-hr']

  it('el itinerario INCLUYE el traslado aunque nadie lo eligió', () => {
    const ids = itemsDelItinerario(VIAJE, seleccion)
    expect(ids).toContain('traslado-priv')
    expect(ids).not.toContain('traslado-comp')
    expect(ids).toEqual(['vuelo-wingo', 'hotel-hr', 'traslado-priv'])
  })

  it('el total del itinerario lo tiene adentro: 1.800.000 + 1.200.000 + 300.000', () => {
    const cascada = cascadaDeItinerario(VIAJE, seleccion, { margenPct: 0, convencionMargen: 'markup' })
    expect(cascada.costoDirecto).toBe(3_300_000)
  })

  it('suma UNA sola alternativa de traslado, nunca las dos', () => {
    const sinTraslado = cascadaDeItinerario(
      VIAJE.filter(i => !i.id.startsWith('traslado-')),
      seleccion,
      { margenPct: 0, convencionMargen: 'markup' },
    )
    const con = cascadaDeItinerario(VIAJE, seleccion, { margenPct: 0, convencionMargen: 'markup' })
    // La diferencia es exactamente UN traslado (el privado), no los dos.
    expect(con.costoDirecto - sinTraslado.costoDirecto).toBe(300_000)
  })

  it('el itinerario está COMPLETO con vuelo y hotel: el traslado no lo bloquea', () => {
    expect(ranurasSinResolver(VIAJE, seleccion)).toEqual([])
    expect(itinerarioCompleto(VIAJE, seleccion)).toBe(true)
  })

  it('sin elegir vuelo, la ranura que falta se NOMBRA y el traslado no aparece', () => {
    expect(ranurasSinResolver(VIAJE, ['hotel-hr'])).toEqual(['vuelo'])
  })
})

describe('una combinación YA guardada que nombra un traslado no se invalida', () => {
  // Las combinaciones generadas ANTES de esta regla traen el traslado en su
  // selección. No se borran ni se recalculan: si la fila nombra el compartido, sigue
  // sumando el compartido y el total de esa cotización no se mueve.
  const guardada = ['vuelo-avianca', 'hotel-occ', 'traslado-comp']

  it('respeta el traslado que la fila nombra, no el primero por orden', () => {
    const ids = itemsDelItinerario(VIAJE, guardada)
    expect(ids).toContain('traslado-comp')
    expect(ids).not.toContain('traslado-priv')
  })

  it('sigue siendo un itinerario completo', () => {
    expect(itinerarioCompleto(VIAJE, guardada)).toBe(true)
  })

  it('una selección que nombra LOS DOS traslados cobra uno solo', () => {
    // No debería existir, pero existía la vía: antes de esta regla un itinerario
    // incompleto podía quedar con dos candidatos del mismo grupo, y `itemsDelItinerario`
    // los sumaba los dos.
    const rota = ['vuelo-avianca', 'hotel-occ', 'traslado-priv', 'traslado-comp']
    const ids = itemsDelItinerario(VIAJE, rota).filter(id => id.startsWith('traslado-'))
    expect(ids).toEqual(['traslado-priv'])
  })
})

describe('el supuesto del traslado se ANUNCIA y es permanente', () => {
  it('las tres ranuras siguen declarando su supuesto, con su naturaleza', () => {
    expect(ranurasPorSupuesto(VIAJE)).toEqual([
      { grupo: 'vuelo', elegido: 'vuelo-avianca', descartados: ['vuelo-wingo', 'vuelo-latam'], combinable: true },
      { grupo: 'hotel', elegido: 'hotel-occ', descartados: ['hotel-hr', 'hotel-par'], combinable: true },
      { grupo: 'traslado', elegido: 'traslado-priv', descartados: ['traslado-comp'], combinable: false },
    ])
  })

  it('el total sin ninguna combinación armada toma uno de cada ranura', () => {
    expect(itemsQueAportanAlTotal(VIAJE)).toEqual(['vuelo-avianca', 'hotel-occ', 'traslado-priv'])
  })
})

describe('qué grupos se cruzan: la lista sale del catálogo de ranuras', () => {
  it('son exactamente dos, y son vuelo y hotel', () => {
    expect([...RANURAS_COMBINABLES]).toEqual(['vuelo_detalle', 'hotel_detalle'])
  })

  it('los sinónimos declarados también se cruzan', () => {
    for (const g of ['vuelo', 'vuelos', 'aereo', 'aéreo', 'tiquete', 'Hotel', 'hoteles', 'alojamiento']) {
      expect(grupoCombinable(g)).toBe(true)
    }
  })

  it('tour, traslado, plan y los grupos propios NO se cruzan', () => {
    for (const g of ['tour', 'tours', 'excursión', 'traslado', 'transfer', 'plan', 'seguro', 'dia-1', null, '']) {
      expect(grupoCombinable(g)).toBe(false)
    }
  })
})
