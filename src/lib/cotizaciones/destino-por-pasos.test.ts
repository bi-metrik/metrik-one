import { describe, expect, it } from 'vitest'

import {
  completaDe,
  conDecisionDelModelo,
  decisionParaAceptar,
  destinoDeReglas,
  fraseDeDestino,
  opcionalSegunLectura,
  serviciosDelMismoTipo,
  serviciosParaElModelo,
  type DecisionDelModelo,
  type DestinoPorPasos,
} from './destino-por-pasos'
import { grupoDeRanura, type TipoRanura } from './ranuras-cotizacion'
import type { LecturaCasilla } from './tarifa-pasajero'
import type { LineaParaUbicar } from './ubicar-lectura'
import { leer, onceDelCasoFijo, SATENA, type Pantallazo } from '../../../test/caso-once-pantallazos'

/**
 * C5 · la frase de a dónde va un pantallazo, antes de aceptar (decisiones 1 y 2 de Noor) y las
 * guardas que no dependen del modelo (M2, M3 de Vera).
 *
 * El recorrido de los 11 se simula sin base: cada «Aceptar» agrega la línea donde dijo la frase,
 * como el servidor (que vuelve a decidir con la misma `ubicarLectura`).
 */

const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }
type Linea = LineaParaUbicar & { entra_al_precio?: boolean | null }

/** Lo que Vera espera de cada uno (tabla §1): `nueva`, o «otra opción de» la captura N. */
const ESPERADO: Record<string, { como: 'nueva' | 'hermana'; de?: string }> = {
  'cap-caso-01': { como: 'nueva' },
  'cap-caso-02': { como: 'nueva' },
  'cap-caso-03': { como: 'nueva' },
  'cap-caso-04': { como: 'hermana', de: 'cap-caso-03' },
  'cap-caso-05': { como: 'nueva' },
  'cap-caso-06': { como: 'hermana', de: 'cap-caso-05' },
  'cap-caso-07': { como: 'nueva' },
  'cap-caso-08': { como: 'nueva' },
  'cap-caso-09': { como: 'nueva' },
  'cap-caso-10': { como: 'hermana', de: 'cap-caso-09' },
  'cap-caso-11': { como: 'nueva' },
}

function lineaDe(p: Pantallazo, grupo: string): Linea {
  return { id: `item-${p.id}`, grupo, nombre: p.lectura.nombre, tarifa_pax: { casillas: { grupo_completo: p.lectura } }, es_ajuste: false }
}

/** Pega los 11 de a uno y devuelve lo que dijo cada frase y las líneas que quedaron. */
function recorrer(decidir: (p: Pantallazo, lineas: readonly Linea[], reglas: DestinoPorPasos) => DestinoPorPasos) {
  const lineas: Linea[] = []
  const usados = new Map<TipoRanura, number>()
  const frases: Record<string, DestinoPorPasos> = {}
  for (const p of onceDelCasoFijo()) {
    const reglas = destinoDeReglas({ tipo: p.tipo, lectura: p.lectura, pistas: p.pistas, lineas, grupoViaje: VIAJE })
    const d = decidir(p, lineas, reglas)
    frases[p.id] = d
    if (d.como === 'hermana') {
      lineas.push(lineaDe(p, lineas.find(l => l.id === d.itemId)!.grupo as string))
    } else if (d.como === 'nueva') {
      const n = (usados.get(p.tipo) ?? 0) + 1
      usados.set(p.tipo, n)
      lineas.push(lineaDe(p, grupoDeRanura({ tipo: p.tipo, numero: n === 1 ? null : n, nombre: null })))
    }
  }
  return { frases, lineas }
}

/** ¿La frase es la que espera Vera? */
function acierta(id: string, d: DestinoPorPasos): boolean {
  const e = ESPERADO[id]
  if (e.como === 'nueva') return d.como === 'nueva'
  return d.como === 'hermana' && d.itemId !== null && (d.itemId === `item-${e.de}` || d.grupo !== null)
}

describe('C5 · la frase de las reglas sobre los 11 del caso fijo', () => {
  it('acierta 10 de 11: la lancha privada la vuelve opción quien cotiza (una actividad siempre suma)', () => {
    const { frases } = recorrer((_p, _l, reglas) => reglas)
    const aciertos = Object.entries(frases).filter(([id, d]) => acierta(id, d)).map(([id]) => id)
    expect(aciertos).toHaveLength(10)
    expect(frases['cap-caso-10'].como).toBe('nueva')
    // SATENA nunca es opción de Avianca, ni el traslado de San Andrés del de Providencia, ni el buceo de Cayo Cangrejo.
    for (const id of ['cap-caso-02', 'cap-caso-08', 'cap-caso-11']) expect(frases[id].como, id).toBe('nueva')
    // Toda frase de las reglas viaja como `auto`: el servidor la vuelve a decidir al aceptar.
    for (const d of Object.values(frases)) expect(decisionParaAceptar(d).decision).toBe('auto')
  })

  it('dice la frase como la escribió Noor', () => {
    const { frases, lineas } = recorrer((_p, _l, reglas) => reglas)
    expect(fraseDeDestino(frases['cap-caso-04'], 'Hotel', lineas)).toBe('Otra opción de: Hotel')
    expect(fraseDeDestino(frases['cap-caso-05'], 'Hotel en San Andrés', lineas)).toBe('Suma aparte: Hotel en San Andrés')
  })
})

// ── M1 · el modelo, con respuestas de prueba ─────────────────────────────────
//
// ⚠️ Estas respuestas NO son una grabación del modelo real: son el doble con que se prueban las
// guardas. La corrida real (con la llave de pruebas) está pendiente, y por eso la pieza
// `modelo_destino` pide `true` explícito y nace apagada (M4).

/** Un modelo que responde lo que dice la tabla de Vera, con su razón. */
function modeloQueAcierta(p: Pantallazo, lineas: readonly Linea[]): DecisionDelModelo {
  const e = ESPERADO[p.id]
  if (e.como === 'nueva') return { como: 'nueva', itemId: null, razon: null, duda: p.id === 'cap-caso-11' }
  const de = lineas.find(l => l.id === `item-${e.de}`)!
  return { como: 'hermana', itemId: de.id, razon: 'La misma excursión con otra lancha: compite con ella.', duda: false }
}

describe('C5 · M1 · con el modelo, la frase acierta igual o mejor que las reglas', () => {
  it('11 de 11 con un modelo que acierta (las reglas: 10)', () => {
    const { frases } = recorrer((p, lineas, reglas) => conDecisionDelModelo({ tipo: p.tipo, reglas, lineas, modelo: modeloQueAcierta(p, lineas) }))
    expect(Object.entries(frases).filter(([id, d]) => acierta(id, d))).toHaveLength(11)
    // El buceo: «Suma aparte», con la razón ámbar de duda.
    expect(frases['cap-caso-11']).toMatchObject({ como: 'nueva', duda: true })
    expect(frases['cap-caso-11'].razon).toMatch(/para que no se pierda/)
    // Lo que decidió el modelo viaja tal cual: «Aceptar» no vuelve a decidir.
    expect(decisionParaAceptar(frases['cap-caso-10'])).toEqual({ decision: 'hermana', destinoId: 'item-cap-caso-09' })
  })

  it('con el modelo apagado, lento o caído (`null`), la frase es la de las reglas', () => {
    const conReglas = recorrer((_p, _l, reglas) => reglas).frases
    const sinModelo = recorrer((p, lineas, reglas) => conDecisionDelModelo({ tipo: p.tipo, reglas, lineas, modelo: null })).frases
    expect(sinModelo).toEqual(conReglas)
  })
})

describe('C5 · M2 y M3 · las guardas de la decisión del modelo', () => {
  const { lineas } = recorrer((_p, _l, reglas) => reglas)
  const hotelProvidencia = lineas.find(l => l.id === 'item-cap-caso-03')!
  const traslado = lineas.find(l => l.id === 'item-cap-caso-07')!
  const buceo = onceDelCasoFijo()[10]
  const reglasBuceo = destinoDeReglas({ tipo: 'actividad', lectura: buceo.lectura, pistas: buceo.pistas, lineas, grupoViaje: VIAJE })

  it('M3: una opción de otro tipo se descarta y queda la regla', () => {
    const d = conDecisionDelModelo({ tipo: 'actividad', reglas: reglasBuceo, lineas, modelo: { como: 'hermana', itemId: hotelProvidencia.id, razon: 'Mismo día', duda: false } })
    expect(d).toEqual(reglasBuceo)
    const t = conDecisionDelModelo({ tipo: 'actividad', reglas: reglasBuceo, lineas, modelo: { como: 'hermana', itemId: traslado.id, razon: 'x', duda: false } })
    expect(t).toEqual(reglasBuceo)
  })

  it('M3: «otra habitación» solo en hotel, y solo de algo que sigue en la cotización', () => {
    expect(conDecisionDelModelo({ tipo: 'actividad', reglas: reglasBuceo, lineas, modelo: { como: 'habitacion', itemId: 'item-cap-caso-09', razon: 'x', duda: false } })).toEqual(reglasBuceo)
    expect(conDecisionDelModelo({ tipo: 'actividad', reglas: reglasBuceo, lineas, modelo: { como: 'hermana', itemId: 'ya-no-esta', razon: 'x', duda: false } })).toEqual(reglasBuceo)
  })

  it('M2: volver opción lo que las reglas dejan aparte exige la razón; sin ella, queda aparte', () => {
    const sin = conDecisionDelModelo({ tipo: 'actividad', reglas: reglasBuceo, lineas, modelo: { como: 'hermana', itemId: 'item-cap-caso-09', razon: null, duda: false } })
    expect(sin).toEqual(reglasBuceo)
    const con = conDecisionDelModelo({ tipo: 'actividad', reglas: reglasBuceo, lineas, modelo: { como: 'hermana', itemId: 'item-cap-caso-09', razon: 'Otra forma de ir a Cayo Cangrejo', duda: false } })
    expect(con).toMatchObject({ como: 'hermana', itemId: 'item-cap-caso-09', razon: 'Otra forma de ir a Cayo Cangrejo', fuente: 'modelo' })
  })

  it('decisión 1: ante la duda, suma aparte y lo dice', () => {
    const d = conDecisionDelModelo({ tipo: 'actividad', reglas: reglasBuceo, lineas, modelo: { como: 'hermana', itemId: 'item-cap-caso-09', razon: null, duda: true } })
    expect(d).toMatchObject({ como: 'nueva', duda: true })
    expect(d.razon).toBe('No es claro si reemplaza a Cayo Cangrejo · lancha compartida: lo dejo aparte para que no se pierda.')
  })

  it('«Completa» no la inventa el modelo', () => {
    const satena = onceDelCasoFijo()[1]
    const reglas = destinoDeReglas({ tipo: 'vuelo', lectura: satena.lectura, pistas: satena.pistas, lineas, grupoViaje: VIAJE })
    expect(conDecisionDelModelo({ tipo: 'vuelo', reglas, lineas, modelo: { como: 'completa', itemId: 'item-cap-caso-01', razon: 'x', duda: false } })).toEqual(reglas)
  })

  it('el menú de la frase solo ofrece servicios del mismo tipo', () => {
    expect(serviciosDelMismoTipo('hotel', lineas).map(s => s.etiqueta)).toEqual(['Hotel', 'Hotel 2'])
    expect(serviciosDelMismoTipo('traslado', lineas)).toHaveLength(2)
    expect(serviciosDelMismoTipo('vuelo', lineas).every(s => s.grupo.startsWith('vuelo'))).toBe(true)
  })

  it('al modelo le llega un servicio por renglón, con lo que identifica cada opción', () => {
    const s = serviciosParaElModelo(lineas)
    expect(s).toHaveLength(9)
    const avianca = s.find(x => x.id === 'item-cap-caso-01')!
    expect(avianca.detalle).toContain('Avianca')
    expect(avianca.detalle).toContain('2026-11-23')
  })
})

describe('C5 · V4 · «Completa {opción}: precio del niño»', () => {
  const satenaSoloAdulto = (): Linea => {
    const l = leer({ ...SATENA, datos: { ...SATENA.datos, netoNino: null, netoInfante: null } })
    return { id: 'v-satena', grupo: 'vuelo 2: Vuelo San Andrés ⇄ Providencia', nombre: 'SATENA', tarifa_pax: { composicion: VIAJE, casillas: { grupo_completo: l } }, es_ajuste: false }
  }
  const conNino = (o: Partial<typeof SATENA.datos> = {}): LecturaCasilla =>
    leer({ ...SATENA, datos: { ...SATENA.datos, ninos: 1, infantes: 0, netoNino: 447_000, netoInfante: null, ...o } })

  it('el mismo vuelo con 6 adultos y 1 niño trae el precio del niño', () => {
    const c = completaDe('vuelo', conNino(), [satenaSoloAdulto()], VIAJE)
    expect(c).toMatchObject({ itemId: 'v-satena', tipos: ['nino'], precios: { nino: 447_000 } })
    const d = destinoDeReglas({ tipo: 'vuelo', lectura: conNino(), pistas: { lugar: null, origen: null, destino: null }, lineas: [satenaSoloAdulto()], grupoViaje: VIAJE })
    expect(fraseDeDestino(d, 'Vuelo', [satenaSoloAdulto()])).toBe('Completa SATENA: precio del niño')
    expect(decisionParaAceptar(d)).toEqual({ decision: 'completa', destinoId: 'v-satena' })
  })

  it('con un solo total, el precio del niño sale restando lo de los adultos', () => {
    const l = conNino()
    const total = { ...l, porTipo: [], ocupacion: { adultos: 6, ninos: 1, infantes: 0, total: 7 } }
    expect(completaDe('vuelo', total, [satenaSoloAdulto()], VIAJE)?.precios).toEqual({ nino: 447_000 })
  })

  it('otra aerolínea, otra ruta, otra fecha u otra moneda no completan nada', () => {
    for (const o of [{ aerolinea: 'Avianca' }, { destino: 'Bogotá BOG' }, { ida: '2026-11-24' }]) {
      expect(completaDe('vuelo', conNino(o), [satenaSoloAdulto()], VIAJE), JSON.stringify(o)).toBeNull()
    }
    expect(completaDe('vuelo', { ...conNino(), moneda: 'USD' }, [satenaSoloAdulto()], VIAJE)).toBeNull()
  })

  it('la misma búsqueda (los mismos pasajeros) no completa: es otra opción o un repetido', () => {
    const misma = leer({ ...SATENA, datos: { ...SATENA.datos, netoNino: null, netoInfante: null } })
    expect(completaDe('vuelo', misma, [satenaSoloAdulto()], VIAJE)).toBeNull()
  })

  it('un hotel o un traslado nunca «completan»', () => {
    expect(completaDe('hotel', conNino(), [satenaSoloAdulto()], VIAJE)).toBeNull()
  })
})

describe('C5 · P11 · Incluido u Opcional por defecto (decisión M)', () => {
  const con = (nombre: string, extra: Partial<LecturaCasilla> = {}) => ({ ...onceDelCasoFijo()[8].lectura, nombre, descripcion: '', notasCliente: [], campos: [], ...extra }) as LecturaCasilla

  it('«tour opcional», «se paga aparte» y «no incluido» como valor llegan Opcional y dicen por qué', () => {
    expect(opcionalSegunLectura('actividad', con('Tour opcional a Cayo Cangrejo'))).toBe('Tour opcional')
    expect(opcionalSegunLectura('actividad', con('Buceo', { descripcion: 'El equipo se paga aparte' }))).toBe('se paga aparte')
    expect(opcionalSegunLectura('traslado', con('Traslado', { campos: [{ label: 'Incluido', valor: 'No incluido' }] }))).toBe('No incluido')
    expect(opcionalSegunLectura('actividad', con('Snorkel (no incluido)'))).toBe('no incluido')
  })

  it('una parte que no está incluida no vuelve opcional al tour', () => {
    expect(opcionalSegunLectura('actividad', con('Tour a Johnny Cay', { descripcion: 'Almuerzo no incluido' }))).toBeNull()
    expect(opcionalSegunLectura('actividad', con('Cayo Cangrejo · lancha compartida'))).toBeNull()
  })

  it('vuelo y hotel no tienen Opcional', () => {
    expect(opcionalSegunLectura('hotel', con('Hotel opcional:'))).toBeNull()
    expect(opcionalSegunLectura('vuelo', con('Tour opcional'))).toBeNull()
  })

  it('lo escrito a mano con «Es opcional» llega Opcional', () => {
    const buceo = onceDelCasoFijo({ buceoOpcional: true })[10]
    expect(opcionalSegunLectura('actividad', buceo.lectura)).toBe('Es opcional: el cliente decide (no suma)')
  })
})
