/**
 * Tarifa pública o neta y el «margen en cero» de la reunión con Trappvel del 2026-10-22 (puntos 1
 * y 2 del brief). Datos ficticios.
 */
import { describe, expect, it } from 'vitest'

import { calcularCascada, type ItemParaCascada } from './totales'
import { cascadaDeItinerario, margenMedible, margenParaElMinimo, motivoDeRechazo, publicasSinComision } from './itinerarios'
import { lineasConMargenPropio } from './margen-propio'
import { tarifasCalculadas, type LineaDeCascada } from './por-pasos-vista'
import {
  esTarifaPublica,
  leerTipoTarifa,
  margenAlElegirTipo,
  propuestaDelTarifario,
  tipoPropuestoPorCanal,
  tipoTarifaDeLinea,
} from './tarifa-publica'
import { leerTarifaPax } from './tarifa-pasajero'

const PUBLICA = { tipoTarifa: { tipo: 'publica', origen: 'persona', por: 'Asesora', en: '2026-10-22T15:00:00.000Z' } }
const params = { margenPct: 15, convencionMargen: 'sobre_venta' as const }

function linea(id: string, costo: number, extra: Partial<LineaDeCascada> = {}): LineaDeCascada {
  return {
    id, nombre: id, grupo: null, opcion_de: null, es_ajuste: false, orden: 0, dia_relativo: null, entra_al_precio: true,
    cantidad: 1, subtotal: costo, numeroDeRubros: 0, costoDeRubros: 0, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_venta: 0, precio_manual: false, base_iva: null, pasajeros: null, tarifa_pax: null, adicionales: [],
    ...extra,
  }
}

describe('el dato: Neta por defecto, Pública cuando alguien lo dice', () => {
  it('sin decisión es Neta; la decisión se lee y sobrevive a `leerTarifaPax`', () => {
    expect(tipoTarifaDeLinea(null)).toBe('neta')
    expect(tipoTarifaDeLinea({ casillas: {} })).toBe('neta')
    expect(esTarifaPublica(PUBLICA)).toBe(true)
    expect(leerTipoTarifa({ tipo: 'otra' })).toBeNull()
    // Toda llave que `leerTarifaPax` no lea se pierde en la siguiente escritura.
    expect(leerTarifaPax(PUBLICA).tipoTarifa).toEqual(PUBLICA.tipoTarifa)
    expect(leerTarifaPax({}).tipoTarifa).toBeUndefined()
  })

  it('el margen al elegir: Pública arranca en 0, Neta hereda; el del proveedor manda en las dos', () => {
    expect(margenAlElegirTipo('publica', null)).toBe(0)
    expect(margenAlElegirTipo('neta', null)).toBeNull()
    expect(margenAlElegirTipo('publica', 12.5)).toBe(12.5)
    expect(margenAlElegirTipo('neta', 12.5)).toBe(12.5)
  })

  it('el tarifario propone: al público o comisionable → Pública; neta retira su propuesta; lo de una persona no se toca', () => {
    expect(tipoPropuestoPorCanal('publica')).toBe('publica')
    expect(tipoPropuestoPorCanal('comisionable')).toBe('publica')
    expect(tipoPropuestoPorCanal('neta')).toBe('neta')
    expect(tipoPropuestoPorCanal('sin_dato')).toBeNull()
    const en = '2026-10-22T16:00:00.000Z'
    expect(propuestaDelTarifario(null, 'publica', en)).toEqual({ tipo: 'publica', origen: 'tarifario', por: null, en })
    expect(propuestaDelTarifario(null, 'sin_dato', en)).toBeNull()
    expect(propuestaDelTarifario(null, 'neta', en)).toBeNull()
    const delTarifario = { tipo: 'publica' as const, origen: 'tarifario' as const, por: null, en }
    expect(propuestaDelTarifario(delTarifario, 'neta', en)).toBe('quitar')
    expect(propuestaDelTarifario(delTarifario, 'publica', en)).toBeNull()
    const dePersona = { tipo: 'neta' as const, origen: 'persona' as const, por: 'Asesora', en }
    expect(propuestaDelTarifario(dePersona, 'publica', en)).toBeNull()
  })
})

// D2 de Mauricio (2026-10-29): el margen general es el de TODAS las líneas; por una Pública la
// agencia paga el precio público menos su comisión. Sin comisión no se puede medir (D3). Hasta ese día
// la Pública salía de la medida y una tarifa solo de Públicas quedaba exenta.
const PUBLICA_10 = { tipoTarifa: { ...PUBLICA.tipoTarifa, comisionPct: 10 } }
const margen = (cliente: number, agencia: number) => ((cliente - agencia) / cliente) * 100

describe('una Pública con margen 0 no suma el 15 %; entra al margen general con su comisión (D2)', () => {
  const hotelNeto = linea('hotel-neto', 1_000_000)
  const trasladoPublico = linea('traslado-publico', 502_000, { margen_porcentaje: 0, tarifa_pax: PUBLICA })
  const trasladoPublico10 = linea('traslado-publico', 502_000, { margen_porcentaje: 0, tarifa_pax: PUBLICA_10 })
  const trasladoACostoNeto = linea('traslado-a-costo', 502_000, { margen_porcentaje: 0 })

  it('el precio al cliente de la Pública es el precio público; el de la Neta, costo más 15 %', () => {
    const c = calcularCascada([hotelNeto, trasladoPublico] as ItemParaCascada[], params)
    expect(c.lineas.find(l => l.id === 'traslado-publico')!.precioLinea).toBe(502_000)
    expect(c.lineas.find(l => l.id === 'hotel-neto')!.precioLinea).toBe(1_176_471)
    expect(c.lineas.find(l => l.id === 'traslado-publico')!.publica).toBe(true)
    expect(c.publicas).toEqual({ lineas: 1, costoDeVenta: 502_000, ventaBruta: 502_000, comision: 0, sinComision: 1 })
  })

  it('sin comisión el margen no se puede medir y el motivo es la comisión (D3), no «bajo el piso»', () => {
    const c = calcularCascada([hotelNeto, trasladoPublico] as ItemParaCascada[], params)
    expect(margenMedible(c)).toBeNull()
    expect(margenParaElMinimo(c)).toBeNull()
    expect(publicasSinComision(c)).toBe(1)
    expect(motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: margenMedible(c), pisoPct: 15, sinComision: publicasSinComision(c) })?.tipo).toBe('sin_comision')
  })

  it('con comisión entra con ella: (cliente − agencia) / cliente sobre todas las líneas', () => {
    const c = calcularCascada([hotelNeto, trasladoPublico10] as ItemParaCascada[], params)
    expect(c.lineas.find(l => l.id === 'traslado-publico')!.comisionPesos).toBe(50_200)
    expect(margenMedible(c)!).toBeCloseTo(margen(1_176_471 + 502_000, 1_000_000 + 451_800), 6)
    expect(motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: margenMedible(c), pisoPct: 15, sinComision: publicasSinComision(c) })?.tipo).toBe('bajo_piso')
    expect(motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: margenMedible(c), pisoPct: 12, sinComision: publicasSinComision(c) })).toBeNull()
    // La misma línea a costo pero Neta deja menos: la agencia paga todo el precio.
    const aCostoNeto = calcularCascada([hotelNeto, trasladoACostoNeto] as ItemParaCascada[], params)
    expect(margenMedible(aCostoNeto)!).toBeCloseTo(margen(1_678_471, 1_502_000), 6)
  })

  it('una tarifa que solo cobra Públicas ya no queda exenta: sin comisión frena, con comisión se mide', () => {
    const sin = calcularCascada([trasladoPublico] as ItemParaCascada[], params)
    expect(margenMedible(sin)).toBeNull()
    expect(motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: margenMedible(sin), pisoPct: 15, sinComision: publicasSinComision(sin) })?.tipo).toBe('sin_comision')
    const con = calcularCascada([trasladoPublico10] as ItemParaCascada[], params)
    expect(margenMedible(con)!).toBeCloseTo(10, 6)
    expect(motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: margenMedible(con), pisoPct: 15, sinComision: 0 })?.tipo).toBe('bajo_piso')
  })

  it('la comisión en pesos vale igual que en %, sobre el precio público', () => {
    const enPesos = linea('traslado-publico', 502_000, { margen_porcentaje: 0, tarifa_pax: { tipoTarifa: { ...PUBLICA.tipoTarifa, comisionMonto: 50_200 } } })
    const c = calcularCascada([hotelNeto, enPesos] as ItemParaCascada[], params)
    expect(c.publicas.comision).toBe(50_200)
    expect(margenMedible(c)!).toBeCloseTo(margenMedible(calcularCascada([hotelNeto, trasladoPublico10] as ItemParaCascada[], params))!, 6)
  })

  it('subir a mano el margen de una Pública sí sube su precio, y la agencia sigue pagando público − comisión', () => {
    const c = calcularCascada([hotelNeto, { ...trasladoPublico10, margen_porcentaje: 5 }] as ItemParaCascada[], params)
    expect(c.lineas.find(l => l.id === 'traslado-publico')!.precioLinea).toBe(528_421)
    expect(margenMedible(c)!).toBeCloseTo(margen(1_176_471 + 528_421, 1_000_000 + 451_800), 6)
  })

  it('sin líneas Públicas, todo da exactamente lo de siempre', () => {
    const c = calcularCascada([hotelNeto, linea('vuelo', 800_000)] as ItemParaCascada[], params)
    expect(c.publicas.lineas).toBe(0)
    expect(margenMedible(c)).toBe(c.margenRealPct)
    expect(margenParaElMinimo(c)).toBe(c.margenRealPct)
  })
})

describe('las tres opciones respetan el tipo de cada línea', () => {
  // Un vuelo neto igual en todas; tres hoteles: el de la Económica y el de la Premium a precio
  // público, el de la Recomendada neto.
  const conHoteles = (tarifaPax: unknown): LineaDeCascada[] => [
    linea('vuelo', 2_000_000, { grupo: 'vuelo: Bogotá - Cancún', orden: 1 }),
    linea('hotel-eco', 1_500_000, { grupo: 'hotel: Hotel en Cancún', orden: 2, margen_porcentaje: 0, tarifa_pax: tarifaPax }),
    linea('hotel-rec', 2_000_000, { grupo: 'hotel: Hotel en Cancún', orden: 3 }),
    linea('hotel-pre', 4_000_000, { grupo: 'hotel: Hotel en Cancún', orden: 4, margen_porcentaje: 0, tarifa_pax: tarifaPax }),
  ]
  const tarifas = [
    { id: 't-eco', nombre: 'Económica', orden: 1, vaEnPropuesta: true, seleccion: ['hotel-eco'] },
    { id: 't-rec', nombre: 'Recomendada', orden: 2, vaEnPropuesta: true, seleccion: ['hotel-rec'] },
    { id: 't-pre', nombre: 'Premium', orden: 3, vaEnPropuesta: true, seleccion: ['hotel-pre'] },
  ]

  it('cada tarifa cobra su hotel como es: el público sin margen, el neto con el 15 %', () => {
    const t = tarifasCalculadas(conHoteles(PUBLICA), params, tarifas)
    const de = (id: string) => t.find(x => x.id === id)!
    expect(de('t-eco').precio).toBe(2_352_941 + 1_500_000)
    expect(de('t-rec').precio).toBe(2_352_941 + 2_352_941)
    expect(de('t-pre').precio).toBe(2_352_941 + 4_000_000)
    expect([de('t-eco').publicas, de('t-rec').publicas, de('t-pre').publicas]).toEqual([1, 0, 1])
    // Sin comisión, la Económica y la Premium no se pueden medir (D3); la Recomendada, toda Neta, al 15 %.
    expect([de('t-eco').sinComision, de('t-rec').sinComision, de('t-pre').sinComision]).toEqual([1, 0, 1])
    expect(de('t-eco').margenReal).toBeNull()
    expect(de('t-rec').margenReal!).toBeCloseTo(15, 2)
  })

  it('con comisión, el margen general de cada tarifa cuenta su hotel público (D2)', () => {
    const lineas = conHoteles({ tipoTarifa: { ...PUBLICA.tipoTarifa, comisionPct: 20 } })
    const t = tarifasCalculadas(lineas, params, tarifas)
    const de = (id: string) => t.find(x => x.id === id)!
    expect(de('t-eco').margenReal!).toBeCloseTo(margen(2_352_941 + 1_500_000, 2_000_000 + 1_200_000), 4)
    expect(de('t-pre').margenReal!).toBeCloseTo(margen(2_352_941 + 4_000_000, 2_000_000 + 3_200_000), 4)
    // Con un mínimo del 15 %, la Económica (16,9 %) pasa y la Premium (18,1 %) también…
    for (const id of ['t-eco', 't-pre']) {
      const c = cascadaDeItinerario(lineas, tarifas.find(x => x.id === id)!.seleccion, params)
      expect(motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: margenMedible(c), pisoPct: 15, sinComision: publicasSinComision(c) })).toBeNull()
    }
    // …y con los mismos hoteles a costo pero Netos, las dos la pedirían.
    const netas = lineas.map(l => ({ ...l, tarifa_pax: null }))
    for (const id of ['t-eco', 't-pre']) {
      const c = cascadaDeItinerario(netas, tarifas.find(x => x.id === id)!.seleccion, params)
      expect(motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: margenMedible(c), pisoPct: 10, sinComision: publicasSinComision(c) })?.tipo).toBe('bajo_piso')
    }
  })
})

describe('punto 2 · el margen que aparecía en 0', () => {
  // Lo que pasó en la reunión: a cada opción se le puso margen 0 en su tarjeta (sus precios ya
  // traían la comisión) y después se subió el margen de la cotización a 15 en «Tarifas».
  const aCero = (id: string, costo: number, grupo: string, orden: number) => linea(id, costo, { grupo, orden, margen_porcentaje: 0 })
  const lineas: LineaDeCascada[] = [
    aCero('vuelo', 2_000_000, 'vuelo: Bogotá - Cancún', 1),
    aCero('hotel-a', 1_500_000, 'hotel: Hotel en Cancún', 2),
    aCero('hotel-b', 2_500_000, 'hotel: Hotel en Cancún', 3),
    aCero('traslado', 300_000, 'traslado: Aeropuerto - hotel', 4),
  ]
  const tarifas = [
    { id: 't-eco', nombre: 'Económica', orden: 1, vaEnPropuesta: true, seleccion: ['hotel-a'] },
    { id: 't-rec', nombre: 'Recomendada', orden: 2, vaEnPropuesta: true, seleccion: ['hotel-b'] },
  ]

  it('reproducido: con el margen de la cotización en 15, las tarifas siguen en 0 % y bajo el mínimo', () => {
    const t = tarifasCalculadas(lineas, { ...params, margenPct: 15 }, tarifas)
    for (const x of t) expect(x.margenReal).toBe(0)
    // La causa: cada opción lleva su margen propio (0) y no sigue el de la cotización.
    expect(lineasConMargenPropio(lineas, 15, 'sobre_venta').map(l => l.id)).toEqual(['vuelo', 'hotel-a', 'hotel-b', 'traslado'])
  })

  it('corregido (a): marcadas Públicas, piden su comisión (D3) y la lista de margen propio queda vacía', () => {
    const publicas = lineas.map(l => ({ ...l, tarifa_pax: PUBLICA }))
    const t = tarifasCalculadas(publicas, { ...params, margenPct: 15 }, tarifas)
    for (const x of t) {
      expect(x.sinComision).toBe(3)
      expect(x.margenReal).toBeNull()
    }
    expect(lineasConMargenPropio(publicas, 15, 'sobre_venta')).toEqual([])
  })

  it('corregido (b): «Que usen el margen de la cotización» las deja heredando y el 15 % se ve', () => {
    const heredan = lineas.map(l => ({ ...l, margen_porcentaje: null }))
    const t = tarifasCalculadas(heredan, { ...params, margenPct: 15 }, tarifas)
    for (const x of t) expect(x.margenReal!).toBeCloseTo(15, 2)
    expect(lineasConMargenPropio(heredan, 15, 'sobre_venta')).toEqual([])
  })

  it('no cuenta como margen propio: el igual al de la cotización, el de precio a mano ni el del proveedor', () => {
    const delProveedor = linea('con-comision', 1_000_000, {
      margen_porcentaje: 10,
      tarifa_pax: { confirmada: { margenProveedor: { margenPct: 10, precioCliente: 1_111_111, costoAgencia: 1_000_000 } } },
    })
    expect(lineasConMargenPropio([
      linea('igual', 1, { margen_porcentaje: 15 }),
      linea('a-mano', 1, { margen_porcentaje: 0, precio_manual: true }),
      delProveedor,
      linea('propio', 1, { margen_porcentaje: 8 }),
    ], 15, 'sobre_venta').map(l => l.id)).toEqual(['propio'])
  })
})
