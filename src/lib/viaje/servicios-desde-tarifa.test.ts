/**
 * De la tarifa aceptada a las filas de servicio (F0-1, F0-2 de Vera). Casos sintéticos.
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez sobre `servicios-desde-tarifa.ts`:
 *  · sin el cuadre del residuo → cae «Σ costo = costo directo al peso» (1);
 *  · con `itemsQueAportanAlTotal` también cuando hay selección → cae «solo la tarifa aceptada» (1);
 *  · sin la ranura del ítem (solo el grupo) → cae «manda la ranura» (1);
 *  · descartando los ítems sin grupo → caen «sin ranura ni grupo» y «lo leído del pantallazo» (2).
 * Un filtro propio del ítem de ajuste NO tumbaba nada (ya lo saca `itemsDelItinerario`): se
 * quitó la línea; «ni el ajuste» queda vigilando que siga fuera.
 */
import { describe, expect, it } from 'vitest'
import { fechaIso, filasDeServicioDeTarifa, tipoDeServicio, type ItemParaServicio } from './servicios-desde-tarifa'

function item(id: string, costo: number, extra: Partial<ItemParaServicio> = {}): ItemParaServicio {
  return {
    id, nombre: id.toUpperCase(), grupo: null, opcion_de: null, es_ajuste: false, orden: 1,
    dia_relativo: null, entra_al_precio: null, cantidad: 1, subtotal: costo, numeroDeRubros: 0,
    costoDeRubros: 0, descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: costo * 1.2,
    precio_manual: false, adicionales: [], pasajeros: null, tarifa_pax: null, tramos: null,
    ...extra,
  }
}

const PARAMS = { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const }

/** Cusco: dos vuelos alternativos, un hotel, un traslado, una sugerencia fuera del precio y un ajuste. */
function cusco(): ItemParaServicio[] {
  return [
    item('vuelo-a', 1_800_000, { nombre: 'LATAM BOG-CUZ', grupo: 'vuelo', orden: 1 }),
    item('vuelo-b', 2_100_000, { nombre: 'AVIANCA BOG-CUZ', grupo: 'vuelo', opcion_de: 'vuelo-a', orden: 2 }),
    item('hotel', 1_100_000, { nombre: 'Hotel Andino', grupo: 'hotel', orden: 3 }),
    item('traslado', 200_000, { nombre: 'Traslado aeropuerto', grupo: 'traslado', orden: 4 }),
    item('tour-sugerido', 300_000, { nombre: 'Montaña de colores', grupo: 'actividad', entra_al_precio: false, orden: 5 }),
    item('ajuste', 0, { nombre: 'Cuadre', es_ajuste: true, precio_venta: 5_000, precio_manual: true, orden: 6 }),
  ]
}

describe('filasDeServicioDeTarifa', () => {
  it('solo la tarifa aceptada: N ítems dentro del precio, N filas, en el orden del viaje (F0-1)', () => {
    const filas = filasDeServicioDeTarifa({ items: cusco(), seleccion: ['vuelo-a'], params: PARAMS })
    expect(filas.map(f => f.item_id)).toEqual(['vuelo-a', 'hotel', 'traslado'])
    expect(filas.map(f => f.orden)).toEqual([0, 1, 2])
    expect(filas.map(f => f.tipo)).toEqual(['vuelo', 'hotel', 'traslado'])
  })

  it('ni la sugerencia fuera del precio ni el ajuste crean fila', () => {
    const ids = filasDeServicioDeTarifa({ items: cusco(), seleccion: ['vuelo-b'], params: PARAMS }).map(f => f.item_id)
    expect(ids).toEqual(['vuelo-b', 'hotel', 'traslado'])
    expect(ids).not.toContain('tour-sugerido')
    expect(ids).not.toContain('ajuste')
  })

  it('Σ costo cotizado = costo directo de la tarifa: 3.100.000 (caso Cusco del guion de Vera, F0-2)', () => {
    const filas = filasDeServicioDeTarifa({ items: cusco(), seleccion: ['vuelo-a'], params: PARAMS })
    expect(filas.map(f => f.costo_cotizado)).toEqual([1_800_000, 1_100_000, 200_000])
    expect(filas.reduce((s, f) => s + f.costo_cotizado, 0)).toBe(3_100_000)
  })

  it('Σ costo = costo directo al peso aunque cada línea redondee distinto: el residuo va a la más cara', () => {
    const items = [
      item('a', 100.4, { orden: 1 }),
      item('b', 100.4, { orden: 2 }),
      item('c', 200.4, { orden: 3 }),
    ]
    const filas = filasDeServicioDeTarifa({ items, seleccion: null, params: PARAMS })
    // Cada línea sola redondea hacia abajo (100, 100, 200 = 400); el total exacto es 401,2 → 401.
    expect(filas.reduce((s, f) => s + f.costo_cotizado, 0)).toBe(401)
    expect(filas.find(f => f.item_id === 'c')?.costo_cotizado).toBe(201)
  })

  it('los adicionales de la línea (la maleta) son costo del proveedor y entran', () => {
    const items = [item('vuelo', 1_000_000, {
      grupo: 'vuelo',
      adicionales: [{ id: 'm', item_id: 'vuelo', codigo: 'equipaje_bodega', nombre: 'Maleta', cantidad: 1, costo: 120_000, precio: 150_000, moneda: 'COP', tasa_cop: null, origen: 'manual', orden: 1 }] as unknown as ItemParaServicio['adicionales'],
    })]
    expect(filasDeServicioDeTarifa({ items, seleccion: null, params: PARAMS })[0].costo_cotizado).toBe(1_120_000)
  })

  it('sin ranura ni grupo: tipo «otro», no se descarta (los 5 ítems de Q3)', () => {
    const items = [item('fee', 50_000, { nombre: 'Fee de emisión' }), item('hotel', 900_000, { grupo: 'hotel', orden: 2 })]
    const filas = filasDeServicioDeTarifa({ items, seleccion: null, params: PARAMS })
    expect(filas.map(f => [f.item_id, f.tipo])).toEqual([['fee', 'otro'], ['hotel', 'hotel']])
  })

  it('manda la ranura del ítem sobre el grupo', () => {
    const items = [item('x', 100_000, { grupo: 'Paquete especial' })]
    const filas = filasDeServicioDeTarifa({ items, seleccion: null, params: PARAMS, tipoRanuraPorItem: { x: 'traslado' } })
    expect(filas[0].tipo).toBe('traslado')
  })

  it('proveedor y fecha salen del pantallazo leído; si no hay lectura, vacíos', () => {
    const lectura = (identidad: Record<string, string | null>, campos: { label: string; valor: string }[] = []) => ({
      casillas: { grupo_completo: { total: 1, moneda: 'COP', identidad, campos } },
    })
    const items = [
      item('h', 1, { grupo: 'hotel', orden: 1, tarifa_pax: lectura({ hotel: 'Hotel Andino', check_in: '2026-11-21' }) }),
      item('v', 1, { grupo: 'vuelo', orden: 2, tarifa_pax: lectura({ aerolinea: 'LATAM', fecha_salida: '21 nov' }) }),
      item('t', 1, { grupo: 'traslado', orden: 3, tarifa_pax: lectura({ trayecto: 'Aeropuerto - hotel' }, [{ label: 'Proveedor', valor: 'Cusco Transfers' }]) }),
      item('a', 1, { grupo: 'actividad', orden: 4 }),
    ]
    const filas = filasDeServicioDeTarifa({ items, seleccion: null, params: PARAMS })
    expect(filas.map(f => [f.proveedor_nombre, f.fecha_servicio])).toEqual([
      ['Hotel Andino', '2026-11-21'],
      ['LATAM', null], // «21 nov» no es una fecha ISO: no se adivina el año
      ['Cusco Transfers', null],
      [null, null],
    ])
  })
})

describe('tipoDeServicio y fechaIso', () => {
  it('una asistencia o un seguro sin ranura se reconocen por el texto', () => {
    expect(tipoDeServicio({ grupo: null, nombre: 'Asistencia médica internacional' })).toBe('asistencia')
    expect(tipoDeServicio({ grupo: 'seguro', nombre: null })).toBe('asistencia')
    expect(tipoDeServicio({ grupo: 'vuelo 2: Lima a Cusco', nombre: 'LATAM' })).toBe('vuelo')
  })

  it('fechaIso no acepta fechas imposibles', () => {
    expect(fechaIso('2026-02-30')).toBeNull()
    expect(fechaIso('2026-11-21T10:00')).toBe('2026-11-21')
    expect(fechaIso(null)).toBeNull()
  })
})

// ── Número de vuelo por tramo (2026-10-22) ───────────────────────────────────
// Datos ficticios. Antes: la ida guardaba «XX 100 · XX 200» y el regreso quedaba sin número.

describe('número de vuelo por tramo', () => {
  const lectura = (identidad: Record<string, string | null>, campos: { label: string; valor: string }[] = []) => ({
    casillas: { grupo_completo: { total: 1, moneda: 'COP', identidad, campos } },
  })
  const LECTURA_REDONDO = lectura(
    { aerolinea: 'Aerolínea X', origen: 'BOG', destino: 'CUZ', fecha_salida: '2026-11-23', fecha_regreso: '2026-11-28' },
    [
      { label: 'Hora de salida (ida)', valor: '06:50' },
      { label: 'Hora de llegada (ida)', valor: '09:00' },
      { label: 'Hora de salida (regreso)', valor: '18:45' },
      { label: 'Hora de llegada (regreso)', valor: '20:55' },
      { label: 'Nº de vuelo', valor: 'XX 100 · XX 200' },
    ],
  )
  const equipaje = { personal: true, mano: null, bodega: null }
  const tramo = (sentido: 'ida' | 'regreso', extra: Record<string, unknown>) => ({
    sentido, origen: null, destino: null, fecha: null, salida: null, llegada: null, numero: null, escala: null, directo: null, equipaje, ...extra,
  })
  const TRAMOS_REDONDO = [
    tramo('ida', { origen: 'BOG', destino: 'CUZ', fecha: '2026-11-23', salida: '06:50', llegada: '09:00', numero: 'XX 100' }),
    tramo('regreso', { origen: 'CUZ', destino: 'BOG', fecha: '2026-11-28', salida: '18:45', llegada: '20:55', numero: 'XX 200' }),
  ]
  const vuelo = (extra: Partial<ItemParaServicio>) =>
    filasDeServicioDeTarifa({ items: [item('v', 1_000_000, { grupo: 'vuelo', ...extra })], seleccion: null, params: PARAMS })[0]

  it('un vuelo redondo con items.tramos: ida y regreso, cada uno con su número, sus horas y su ruta', () => {
    const f = vuelo({ tarifa_pax: LECTURA_REDONDO, tramos: TRAMOS_REDONDO })
    expect(f.tramos).toEqual([
      { fecha: '2026-11-23', hora_salida: '06:50', hora_llegada: '09:00', origen: 'BOG', destino: 'CUZ', aerolinea: 'Aerolínea X', numero_vuelo: 'XX 100' },
      { fecha: '2026-11-28', hora_salida: '18:45', hora_llegada: '20:55', origen: 'CUZ', destino: 'BOG', aerolinea: 'Aerolínea X', numero_vuelo: 'XX 200' },
    ])
    // Inicio = primer tramo, fin = último: la regla no cambia.
    expect([f.fecha_servicio, f.hora_inicio, f.fecha_fin, f.hora_fin]).toEqual(['2026-11-23', '06:50', '2026-11-28', '20:55'])
    expect(f.proveedor_nombre).toBe('Aerolínea X')
  })

  it('sin items.tramos, igual que hoy: el número completo en la ida y el regreso sin número', () => {
    const f = vuelo({ tarifa_pax: LECTURA_REDONDO, tramos: null })
    expect(f.tramos?.map(t => t.numero_vuelo)).toEqual(['XX 100 · XX 200', null])
    expect([f.fecha_servicio, f.fecha_fin]).toEqual(['2026-11-23', '2026-11-28'])
  })

  it('solo de ida: un tramo con su número', () => {
    const f = vuelo({
      tarifa_pax: lectura({ aerolinea: 'Aerolínea X', origen: 'BOG', destino: 'CUZ', fecha_salida: '2026-11-23' }),
      tramos: [tramo('ida', { origen: 'BOG', destino: 'CUZ', fecha: '2026-11-23', salida: '06:50', numero: 'XX 100' })],
    })
    expect(f.tramos).toEqual([
      { fecha: '2026-11-23', hora_salida: '06:50', hora_llegada: null, origen: 'BOG', destino: 'CUZ', aerolinea: 'Aerolínea X', numero_vuelo: 'XX 100' },
    ])
    expect([f.fecha_servicio, f.fecha_fin]).toEqual(['2026-11-23', '2026-11-23'])
  })

  it('un tramo sin fecha ISO se omite; sin fecha de la ida manda la lectura', () => {
    const sinFechaRegreso = vuelo({ tarifa_pax: LECTURA_REDONDO, tramos: [TRAMOS_REDONDO[0], { ...TRAMOS_REDONDO[1], fecha: '--11-28' }] })
    expect(sinFechaRegreso.tramos?.map(t => t.numero_vuelo)).toEqual(['XX 100'])
    const sinFechaIda = vuelo({ tarifa_pax: LECTURA_REDONDO, tramos: [{ ...TRAMOS_REDONDO[0], fecha: null }, TRAMOS_REDONDO[1]] })
    expect(sinFechaIda.tramos?.map(t => t.numero_vuelo)).toEqual(['XX 100 · XX 200', null])
  })

  it('items.tramos sin ningún número: la ida conserva el de la lectura (no se pierde)', () => {
    const f = vuelo({ tarifa_pax: LECTURA_REDONDO, tramos: TRAMOS_REDONDO.map(t => ({ ...t, numero: null })) })
    expect(f.tramos?.map(t => t.numero_vuelo)).toEqual(['XX 100 · XX 200', null])
  })

  it('items.tramos con forma rota (regreso primero) no se usa: manda la lectura', () => {
    const f = vuelo({ tarifa_pax: LECTURA_REDONDO, tramos: [TRAMOS_REDONDO[1], TRAMOS_REDONDO[0]] })
    expect(f.tramos?.map(t => t.numero_vuelo)).toEqual(['XX 100 · XX 200', null])
  })

  it('el cuadre Σ costo cotizado = costo directo sigue intacto con items.tramos', () => {
    const items = [
      item('v', 1_234_567, { grupo: 'vuelo', orden: 1, tarifa_pax: LECTURA_REDONDO, tramos: TRAMOS_REDONDO }),
      item('h', 765_433, { grupo: 'hotel', orden: 2 }),
    ]
    const filas = filasDeServicioDeTarifa({ items, seleccion: null, params: PARAMS })
    expect(filas.reduce((s, f) => s + f.costo_cotizado, 0)).toBe(2_000_000)
  })
})

