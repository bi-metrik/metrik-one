/**
 * R-A1 · una ranura con alternativas aporta UNA sola vez al total.
 *
 * El caso que llegó vivo a producción no es el que cubre `itinerarios.test.ts`. Allí
 * hay combinaciones construidas y una marcada principal. Aquí hay dos vuelos en la
 * misma ranura y CERO itinerarios: medido en trappvel el 2026-09-14, COT-2026-0001 y
 * COT-2026-0003 tenían titular + alternativa y `cotizacion_itinerarios` estaba vacía
 * en las 20 cotizaciones de la base.
 */

import { describe, it, expect } from 'vitest'

import {
  itemsQueAportanAlTotal,
  itinerarioCompleto,
  ranurasPorSupuesto,
  ranurasSinResolver,
  seleccionSupuesta,
} from './itinerarios'
import { calcularCascada } from './totales'

/** Un ítem de cotización con lo justo para las dos capas (ranura + cascada). */
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

const viaje = [
  item('avianca', { grupo: 'vuelo', orden: 1, subtotal: 2_000_000 }),
  item('wingo', { grupo: 'vuelo', orden: 2, subtotal: 1_825_000, opcion_de: 'avianca' }),
  item('occidental', { grupo: 'hotel', orden: 3, subtotal: 1_350_000 }),
  item('traslado', { grupo: 'traslado', orden: 4, subtotal: 200_000 }),
]
const params = { margenPct: 13, convencionMargen: 'sobre_venta' as const }

describe('R-A1 · qué aporta al total cuando nadie eligió', () => {
  it('el total NO suma las dos aerolíneas', () => {
    const aportan = new Set(itemsQueAportanAlTotal(viaje))
    const total = calcularCascada(viaje.filter(i => aportan.has(i.id)), params)
    const sumaDeTodo = calcularCascada(viaje, params)

    // Lo que NO puede pasar: que el total traiga los dos vuelos.
    expect(sumaDeTodo.costoDirecto).toBe(5_375_000)
    expect(total.costoDirecto).toBe(3_550_000)
    expect(total.costoDirecto).toBe(2_000_000 + 1_350_000 + 200_000)
  })

  it('toma el primero por `orden`, no el primero del arreglo', () => {
    // El arreglo llega al revés a propósito: si la regla dependiera del orden de
    // llegada, aquí tomaría WINGO y el total cambiaría solo por cómo vino la consulta.
    const alReves = [...viaje].reverse()
    expect(itemsQueAportanAlTotal(alReves)).toContain('avianca')
    expect(itemsQueAportanAlTotal(alReves)).not.toContain('wingo')
  })

  it('los componentes fijos aportan siempre', () => {
    const aportan = itemsQueAportanAlTotal(viaje)
    expect(aportan).toContain('occidental')
    expect(aportan).toContain('traslado')
  })

  it('R6 · sin ranuras con alternativas aporta TODO: nada cambia', () => {
    // El control que hace válidas las pruebas de arriba. Termotech, Arca y WMC no
    // declaran grupo en ninguna línea: si esto cambiara, les movería el precio.
    const sinGrupos = [
      item('a', { orden: 1, subtotal: 100 }),
      item('b', { orden: 2, subtotal: 200 }),
      item('c', { orden: 3, subtotal: 300 }),
    ]
    expect(itemsQueAportanAlTotal(sinGrupos)).toEqual(['a', 'b', 'c'])

    // Y un grupo con UN candidato tampoco es ranura: entra solo (R3).
    const unSoloCandidato = [
      item('x', { grupo: 'vuelo', orden: 1, subtotal: 100 }),
      item('y', { orden: 2, subtotal: 200 }),
    ]
    expect(itemsQueAportanAlTotal(unSoloCandidato)).toEqual(['x', 'y'])
    expect(ranurasPorSupuesto(unSoloCandidato)).toEqual([])
  })

  it('el ítem de ajuste no es candidato ni ocupa ranura', () => {
    const conAjuste = [...viaje, item('cuadre', { orden: 9, es_ajuste: true, precio_venta: 50_000 })]
    expect(itemsQueAportanAlTotal(conAjuste)).not.toContain('cuadre')
  })

  it('el supuesto se puede NOMBRAR: qué entró y qué quedó fuera', () => {
    // Un aviso que dice «hay una suposición» sin decir cuál no se puede corregir.
    expect(ranurasPorSupuesto(viaje)).toEqual([
      { grupo: 'vuelo', elegido: 'avianca', descartados: ['wingo'] },
    ])
  })

  it('con TRES candidatos sigue aportando uno solo', () => {
    const tres = [
      ...viaje,
      item('latam', { grupo: 'vuelo', orden: 5, subtotal: 1_900_000, opcion_de: 'avianca' }),
    ]
    const aportan = itemsQueAportanAlTotal(tres)
    expect(aportan.filter(id => ['avianca', 'wingo', 'latam'].includes(id))).toEqual(['avianca'])
    expect(ranurasPorSupuesto(tres)[0].descartados).toEqual(['wingo', 'latam'])
  })

  it('DOS ranuras sin elegir se resuelven las dos, cada una una vez', () => {
    const dosRanuras = [
      ...viaje,
      item('hotel-b', { grupo: 'hotel', orden: 6, subtotal: 900_000, opcion_de: 'occidental' }),
    ]
    expect(itemsQueAportanAlTotal(dosRanuras)).toEqual(['avianca', 'occidental', 'traslado'])
    expect(ranurasPorSupuesto(dosRanuras).map(s => s.grupo)).toEqual(['vuelo', 'hotel'])
  })

  it('`seleccionSupuesta` es una selección COMPLETA: no le falta ninguna ranura', () => {
    // Es lo que permite reusar `itemsDelItinerario` sin inventar una segunda regla.
    expect(ranurasSinResolver(viaje, seleccionSupuesta(viaje))).toEqual([])
    expect(itinerarioCompleto(viaje, seleccionSupuesta(viaje))).toBe(true)
  })

  it('un grupo escrito con espacios es el MISMO grupo', () => {
    // `normalizarGrupo` ya lo resuelve; esto fija que la ranura no se parta en dos por
    // un espacio de más y vuelva a sumar los dos vuelos.
    const conEspacios = [
      item('a', { grupo: 'vuelo', orden: 1, subtotal: 100 }),
      item('b', { grupo: '  vuelo  ', orden: 2, subtotal: 200 }),
    ]
    expect(itemsQueAportanAlTotal(conEspacios)).toEqual(['a'])
  })
})
