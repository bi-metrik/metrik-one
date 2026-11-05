/**
 * Prueba en producción del 2026-11-05, viaje 02 de Trappvel (PR #1422 ya mergeado): los 4 pantallazos del
 * bloqueo subidos JUNTOS a la bandeja general de «Armar el viaje»:
 *
 *   Paquete A = vuelo Avianca + hotel GHL (Tu Reserva)
 *   Paquete B = vuelo LATAM   + hotel Decameron (Aliados)
 *
 * La bandeja los arma uno a la vez en el orden en que termina la detección. Con la regla del «paquete
 * vigente» (pensada para UN operador) quedó «Paquete 1 = Avianca + GHL + Decameron, Paquete 2 = LATAM»:
 * al cliente le llegaba la opción de Aliados con el vuelo de Avianca.
 *
 * El modelo es un doble: lo que «respondió» es JSON armado a mano y pasa por los mismos saneadores que
 * la respuesta real (`hotelDesdeLectura`, `vueloDesdeLectura`). Ni llaves ni red ni cuota.
 */
import { describe, expect, it } from 'vitest'

import ghlRaw from './__fixtures__/bloqueo/tureserva-ghl-tres-columnas.json'
import {
  MENSAJE_VUELO_VARIOS_OPERADORES,
  mensajeVueloDelOperador,
  opcionesDelMismoPaquete,
  paquetesConTarifaPorElegir,
  paquetesDelBloqueo,
  planDelPegado,
  type ContextoDeArmado,
  type LecturaParaArmar,
  type OpcionDeBloqueo,
  type PlanDeArmado,
} from './bloqueo-armado'
import { ESQUEMA_VUELO_BLOQUEO, PROMPT_VUELO_BLOQUEO, hotelDesdeLectura, vueloDesdeLectura } from './bloqueo-extraccion'
import { operadorInicialDelPaquete, operadoresDeLaSolicitud } from './bloqueo-operador'
import { itemsDelItinerario } from './itinerarios'
import { aplicarPlan, planDeTarifas, type TarifaDelPlan } from './tarifas-por-pasos'
import { recomendadaDe } from './tarifas'

// ── Lo que «respondió» el modelo a cada pantallazo ─────────────────────────────

function hotel(raw: unknown): LecturaParaArmar {
  const h = hotelDesdeLectura(raw)
  if (!h.ok) throw new Error(h.motivo)
  return { cual: 'hotel', hotel: h.hotel, incluye: h.incluye, operador: h.operador }
}
function vuelo(raw: unknown): LecturaParaArmar {
  const v = vueloDesdeLectura(raw)
  if (!v.ok) throw new Error(v.motivo)
  return { cual: 'vuelo', vuelo: v.vuelo, operador: v.operador }
}

const tramo = (aerolinea: string, numero: string, origen: string, destino: string, fecha: string) => ({
  aerolinea, numero_vuelo: numero, origen, destino, fecha, hora_salida: '06:00', hora_llegada: '08:10', fecha_llegada: fecha, directo: true, escalas: 0,
})

const AVIANCA = vuelo({ es_vuelo: true, tramos: [tramo('Avianca', '8410', 'BOG', 'ADZ', '2027-02-05'), tramo('Avianca', '8411', 'ADZ', 'BOG', '2027-02-10')] })
const LATAM = vuelo({ es_vuelo: true, tramos: [tramo('LATAM', '4120', 'BOG', 'ADZ', '2027-02-05'), tramo('LATAM', '4121', 'ADZ', 'BOG', '2027-02-10')] })
// El logo de Tu Reserva se ve en el pantallazo del GHL.
const GHL = hotel({ ...ghlRaw, operador: 'Tu Reserva' })
const DECAMERON = hotel({
  es_oferta_de_hotel: true,
  hotel: 'Decameron Aquarium',
  zona: 'Zona Norte',
  noches: 5,
  plan_alimentacion: 'Todo Incluido',
  moneda: 'COP',
  operador: 'Aliados Travel',
  precios_por_persona: [{ acomodacion: 'doble', precio: 3_100_000 }, { acomodacion: 'triple', precio: 2_950_000 }],
})
const NOMBRE: Record<string, LecturaParaArmar> = { Avianca: AVIANCA, GHL, Decameron: DECAMERON, LATAM }

// La solicitud del viaje 02 nombra a los dos operadores en un solo campo.
const SOLICITUD = 'ALIADOS TRAVEL Y TU RESERVA'
const CTX: ContextoDeArmado = {
  operadorInicial: operadorInicialDelPaquete(SOLICITUD),
  operadoresSolicitud: operadoresDeLaSolicitud(SOLICITUD),
  pasajeros: { adultos: 2, ninos: 0, infantes: 0 },
  edadesNinos: [],
}

/**
 * Aplica los planes sobre una cotización en memoria, como lo haría `pegarEnBloqueo`: un paquete nuevo
 * entra en la ranura que dice el plan (`grupo`) y solo sin ella abre una (`crearRanuraConOpcion`).
 */
function simular(lecturas: LecturaParaArmar[], ctx = CTX) {
  const opciones: OpcionDeBloqueo[] = []
  const planes: PlanDeArmado[] = []
  for (const l of lecturas) {
    const p = planDelPegado(opciones, l, ctx)
    planes.push(p)
    const orden = opciones.length + 1
    if (p.accion === 'nuevo_paquete') {
      const enRanura = p.grupo ? opciones.find(o => o.grupo === p.grupo) : undefined
      const numero = enRanura?.numero ?? (opciones.length ? Math.max(...opciones.map(o => o.numero)) + 1 : 1)
      const grupo = enRanura?.grupo ?? (numero === 1 ? 'paquete de bloqueo' : `paquete de bloqueo ${numero}`)
      opciones.push({ itemId: `it-${orden}`, grupo, numero, paquete: p.paquete, tarifa: p.tarifa, orden })
    } else if (p.accion === 'nueva_opcion') {
      const numero = opciones.find(o => o.grupo === p.grupo)!.numero
      opciones.push({ itemId: `it-${orden}`, grupo: p.grupo, numero, paquete: p.paquete, tarifa: p.tarifa, orden })
    } else if (p.accion === 'actualizar') {
      for (const c of p.cambios) opciones.find(o => o.itemId === c.itemId)!.paquete = c.paquete
    }
  }
  return { opciones, planes }
}

/**
 * Cada paquete como lo vería la asesora: «operador | vuelo | hoteles». Ordenado: no depende del número.
 * Un paquete = mismo operador y mismo vuelo dentro de la ranura (`paquetesDelBloqueo`, 2026-11-05).
 */
function paquetes(opciones: readonly OpcionDeBloqueo[]): string[] {
  return paquetesDelBloqueo(opciones).map(p => p.opciones).map(os => {
    const v = os.find(o => o.paquete?.vuelo)?.paquete?.vuelo?.tramos[0]
    const hoteles = os.map(o => o.paquete?.hotel.hotel).filter(Boolean).sort().join(' + ')
    return `${os[0].paquete?.operador ?? '¿operador?'} | ${v ? `${v.aerolinea} ${v.numeroVuelo}` : 'sin vuelo'} | ${hoteles || 'sin hotel'}`
  }).sort()
}

function permutaciones<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]]
  return xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r]))
}

describe('viaje 02: la bandeja reparte por operador, no por orden de llegada', () => {
  it('en el orden malo (Avianca, GHL, Decameron, LATAM) Decameron NO cae con el vuelo de Avianca ni con GHL', () => {
    const { opciones, planes } = simular([AVIANCA, GHL, DECAMERON, LATAM])
    const decameron = opciones.find(o => o.paquete?.hotel.hotel === 'Decameron Aquarium')!
    const ghl = opciones.find(o => o.paquete?.hotel.hotel === 'GHL Relax Hotel Sunrise Beach')!
    // Lo que pasó en producción: Decameron era otra opción del paquete de GHL, con el vuelo de Avianca.
    expect(opcionesDelMismoPaquete(opciones, decameron.itemId)).not.toContain(ghl.itemId)
    expect(decameron.paquete!.vuelo).toBeNull()
    expect(ghl.paquete!.vuelo).toBeNull()
    expect(decameron.paquete!.operador).toBe('ALIADOS TRAVEL')
    expect(ghl.paquete!.operador).toBe('TU RESERVA')
    expect(paquetes(opciones)).toEqual([
      'ALIADOS TRAVEL | sin vuelo | Decameron Aquarium',
      'TU RESERVA | sin vuelo | GHL Relax Hotel Sunrise Beach',
      '¿operador? | Avianca 8410 | sin hotel',
      '¿operador? | LATAM 4120 | sin hotel',
    ])
    // Cada vuelo dice a la asesora que lo ponga en su paquete.
    expect(planes.filter(p => p.accion === 'nuevo_paquete' && p.mensaje === MENSAJE_VUELO_VARIOS_OPERADORES)).toHaveLength(2)
  })

  it('las 24 órdenes de llegada arman los MISMOS paquetes, y ninguno junta hotel con vuelo de otro operador', () => {
    const esperado = paquetes(simular([AVIANCA, GHL, DECAMERON, LATAM]).opciones)
    for (const orden of permutaciones(Object.keys(NOMBRE))) {
      const { opciones } = simular(orden.map(n => NOMBRE[n]))
      expect(paquetes(opciones), orden.join(', ')).toEqual(esperado)
      for (const o of opciones) {
        if (o.paquete?.hotel.hotel) expect(o.paquete.vuelo, `${orden.join(', ')}: ${o.paquete.hotel.hotel}`).toBeNull()
      }
    }
  })

  it('un segundo hotel del MISMO operador sí entra al paquete de ese operador, en cualquier orden', () => {
    const iberostar = hotel({ es_oferta_de_hotel: true, hotel: 'Sol Caribe Campo', noches: 5, operador: 'TU RESERVA', precios_por_persona: [{ acomodacion: 'doble', precio: 2_000_000 }] })
    for (const orden of [[GHL, DECAMERON, iberostar], [iberostar, DECAMERON, GHL], [DECAMERON, iberostar, GHL]]) {
      expect(paquetes(simular(orden).opciones)).toEqual([
        'ALIADOS TRAVEL | sin vuelo | Decameron Aquarium',
        'TU RESERVA | sin vuelo | GHL Relax Hotel Sunrise Beach + Sol Caribe Campo',
      ])
    }
  })

  it('un hotel sin operador leído abre su propio paquete (no se adivina) y lo dice', () => {
    const sinOperador = hotel({ ...ghlRaw, operador: null })
    const { opciones, planes } = simular([GHL, DECAMERON, hotel({ ...ghlRaw, hotel: 'Hotel Sin Logo', operador: null }), sinOperador])
    // Cada uno es un paquete nuevo, y todos compiten en la misma ranura del bloqueo.
    expect(planes.map(p => p.accion)).toEqual(['nuevo_paquete', 'nuevo_paquete', 'nuevo_paquete', 'nuevo_paquete'])
    expect(new Set(opciones.map(o => o.grupo)).size).toBe(1)
    expect(opciones).toHaveLength(4)
    expect(planes[2]).toMatchObject({ accion: 'nuevo_paquete', mensaje: 'Paquete nuevo con Hotel Sin Logo. No se vio de qué operador es: elígelo en el paquete.' })
  })

  it('un operador leído que no es de la solicitud (la marca del hotel) cuenta como no leído', () => {
    const { opciones } = simular([GHL, hotel({ ...ghlRaw, hotel: 'Decameron Isleño', operador: 'Decameron' })])
    expect(paquetesDelBloqueo(opciones)).toHaveLength(2)
    expect(opciones[1].paquete!.operador).toBeNull()
  })

  it('el mismo vuelo dos veces no abre otro paquete', () => {
    const { planes } = simular([AVIANCA, GHL, AVIANCA])
    expect(planes[2]).toEqual({ accion: 'repetido', mensaje: 'Ese vuelo ya está en un paquete.' })
  })

  it('con UN operador en la solicitud sigue la regla de siempre (vuelo + hoteles en el paquete vigente)', () => {
    const uno: ContextoDeArmado = { ...CTX, operadorInicial: 'TU RESERVA', operadoresSolicitud: operadoresDeLaSolicitud('TU RESERVA') }
    expect(paquetes(simular([AVIANCA, GHL, DECAMERON], uno).opciones)).toEqual([
      'TU RESERVA | Avianca 8410 | Decameron Aquarium + GHL Relax Hotel Sunrise Beach',
    ])
  })
})

// ── El vuelo también dice su operador (2026-11-05, segunda vuelta) ──────────────
//
// Los pantallazos de vuelo de los operadores traen el operador en el encabezado, como los de hotel:
// «tureserva · Salidas en bloqueo» (Avianca) y «aliadostravel · Bloqueos» (LATAM). Con eso el vuelo
// va al paquete de su operador y el viaje 02 queda en 2 paquetes sin que la asesora mueva nada.

const vueloAv = { es_vuelo: true, tramos: [tramo('Avianca', '8410', 'BOG', 'ADZ', '2027-02-05'), tramo('Avianca', '8411', 'ADZ', 'BOG', '2027-02-10')] }
const vueloLa = { es_vuelo: true, tramos: [tramo('LATAM', '4120', 'BOG', 'ADZ', '2027-02-05'), tramo('LATAM', '4121', 'ADZ', 'BOG', '2027-02-10')] }
// Como lo escribe el encabezado (el logo en minúscula y pegado), no como la solicitud.
const AVIANCA_TR = vuelo({ ...vueloAv, operador: 'tureserva' })
const LATAM_AL = vuelo({ ...vueloLa, operador: 'aliadostravel' })
const CON_OPERADOR: Record<string, LecturaParaArmar> = { Avianca: AVIANCA_TR, GHL, Decameron: DECAMERON, LATAM: LATAM_AL }

describe('viaje 02: el vuelo con operador leído va al paquete de su operador', () => {
  it('el lector del vuelo pide el operador (prompt y esquema) y la limpieza lo devuelve', () => {
    expect(PROMPT_VUELO_BLOQUEO).toContain('- operador: el operador mayorista que vende el paquete')
    expect(PROMPT_VUELO_BLOQUEO).toContain('NO es la aerolínea ni el hotel.')
    expect(ESQUEMA_VUELO_BLOQUEO.properties).toHaveProperty('operador')
    const v = vueloDesdeLectura({ ...vueloAv, operador: '  tureserva ' })
    expect(v.ok && v.operador).toBe('tureserva')
    const sin = vueloDesdeLectura(vueloAv)
    expect(sin.ok && sin.operador).toBeNull()
  })

  it('las 24 órdenes de llegada dan 2 paquetes: Tu Reserva = Avianca + GHL, Aliados = LATAM + Decameron', () => {
    for (const orden of permutaciones(Object.keys(CON_OPERADOR))) {
      const { opciones } = simular(orden.map(n => CON_OPERADOR[n]))
      expect(paquetes(opciones), orden.join(', ')).toEqual([
        'ALIADOS TRAVEL | LATAM 4120 | Decameron Aquarium',
        'TU RESERVA | Avianca 8410 | GHL Relax Hotel Sunrise Beach',
      ])
    }
  })

  it('el vuelo que llega después del hotel se pone en todas las opciones del paquete, sin tocar la tarifa', () => {
    const sol = hotel({ es_oferta_de_hotel: true, hotel: 'Sol Caribe Campo', noches: 5, operador: 'TU RESERVA', precios_por_persona: [{ acomodacion: 'doble', precio: 2_000_000 }] })
    const { opciones, planes } = simular([GHL, sol, DECAMERON])
    // La asesora respondió Pública en el paquete de Tu Reserva.
    const publica = { tipo: 'publica' as const, comision: { tipo: 'pct' as const, valor: 10 } }
    for (const o of opciones) if (o.paquete?.operador === 'TU RESERVA') { o.tarifa = publica; o.paquete = { ...o.paquete, tarifaPorElegir: false } }
    const plan = planDelPegado(opciones, AVIANCA_TR, CTX)
    expect(planes[1].accion).toBe('nueva_opcion')
    expect(plan.accion).toBe('actualizar')
    if (plan.accion !== 'actualizar') return
    const deTuReserva = opciones.filter(o => o.paquete?.operador === 'TU RESERVA').map(o => o.itemId).sort()
    expect(plan.cambios.map(c => c.itemId).sort()).toEqual(deTuReserva)
    for (const c of plan.cambios) {
      expect(c.paquete.vuelo?.tramos[0].numeroVuelo).toBe('8410')
      expect(c.paquete.tarifaPorElegir).toBe(false)
      expect(c.paquete.hotel.hotel).toBeTruthy()
    }
  })

  it('un paquete sin responder Pública / Neta sigue con la pregunta abierta al recibir su vuelo', () => {
    const { opciones } = simular([GHL, AVIANCA_TR])
    expect(opciones).toHaveLength(1)
    expect(opciones[0].paquete!.tarifaPorElegir).toBe(true)
    expect(opciones[0].tarifa).toBeNull()
  })

  it('el vuelo primero abre el paquete de su operador con el mensaje propio, y el hotel llega ahí', () => {
    const { opciones, planes } = simular([LATAM_AL, DECAMERON])
    expect(planes[0]).toMatchObject({ accion: 'nuevo_paquete', mensaje: mensajeVueloDelOperador('ALIADOS TRAVEL') })
    expect(mensajeVueloDelOperador('ALIADOS TRAVEL')).toBe('Paquete nuevo de ALIADOS TRAVEL con este vuelo: los hoteles de ALIADOS TRAVEL que pegues van a este paquete.')
    expect(planes[0].accion === 'nuevo_paquete' && planes[0].paquete.operador).toBe('ALIADOS TRAVEL')
    expect(planes[1].accion).toBe('actualizar')
    expect(paquetes(opciones)).toEqual(['ALIADOS TRAVEL | LATAM 4120 | Decameron Aquarium'])
  })

  it('un paquete del operador que ya tiene OTRO vuelo no se pisa: el vuelo abre paquete propio de ese operador', () => {
    const otroAv = vuelo({ es_vuelo: true, operador: 'Tu Reserva', tramos: [tramo('Avianca', '9370', 'BOG', 'ADZ', '2027-02-05')] })
    const { opciones, planes } = simular([GHL, AVIANCA_TR, otroAv])
    expect(planes[2]).toMatchObject({ accion: 'nuevo_paquete', mensaje: mensajeVueloDelOperador('TU RESERVA') })
    expect(paquetes(opciones)).toEqual([
      'TU RESERVA | Avianca 8410 | GHL Relax Hotel Sunrise Beach',
      'TU RESERVA | Avianca 9370 | sin hotel',
    ])
  })

  it('un vuelo con operador que no es de la solicitud (la aerolínea) cuenta como no leído', () => {
    const { opciones, planes } = simular([GHL, vuelo({ ...vueloAv, operador: 'Avianca' })])
    expect(planes[1]).toMatchObject({ accion: 'nuevo_paquete', mensaje: MENSAJE_VUELO_VARIOS_OPERADORES })
    expect(paquetesDelBloqueo(opciones)).toHaveLength(2)
  })

  it('con UN operador en la solicitud el operador del vuelo no cambia nada', () => {
    const uno: ContextoDeArmado = { ...CTX, operadorInicial: 'TU RESERVA', operadoresSolicitud: operadoresDeLaSolicitud('TU RESERVA') }
    const con = simular([AVIANCA_TR, GHL, DECAMERON, LATAM_AL], uno)
    const sin = simular([AVIANCA, GHL, DECAMERON, LATAM], uno)
    expect(con.planes).toEqual(sin.planes)
  })
})

// ── Los paquetes COMPITEN, no se suman (reprueba en producción del 2026-11-05, viaje 02) ─────────────
//
// Con #1431 la bandeja armó bien los 2 paquetes, pero cada uno en su propia ranura: Tarifas los sumaba
// en una sola tarifa («No hay nada que escoger… le llega una sola tarifa»; venta $19.946.588 =
// $10.666.588 + $9.280.000). La asesora lo arregló con «Juntar como opción de…»: una ranura, Recomendada
// y Opción 2. Ahora la bandeja lo deja así sola.

/** El costo de cada paquete en la prueba: el de la bitácora (A = Tu Reserva, B = Aliados). */
const COSTO: Record<string, number> = { 'TU RESERVA': 10_666_588, 'ALIADOS TRAVEL': 9_280_000 }

/** Las tarifas que deja `planDeTarifas` (el cierre de toda acción por pasos) y el total de cada una. */
function tarifasDe(opciones: readonly OpcionDeBloqueo[]) {
  const items = opciones.map(o => ({ id: o.itemId, grupo: o.grupo, orden: o.orden ?? null, costo: COSTO[o.paquete?.operador ?? ''] ?? null }))
  const costoDe = (id: string) => items.find(i => i.id === id)?.costo ?? null
  let n = 0
  const tarifas: TarifaDelPlan[] = aplicarPlan([], planDeTarifas({ antes: null, despues: { items, tarifas: [] }, costoDe }), () => `t${++n}`)
  const total = (seleccion: string[]) => itemsDelItinerario(items, seleccion).reduce((s, id) => s + (costoDe(id) ?? 0), 0)
  // Sin tarifas, el cliente recibe UNA sola: todo lo que hay en la cotización.
  const totales = tarifas.length === 0 ? [total([])] : tarifas.map(t => total(t.seleccion))
  return { tarifas, totales }
}

describe('viaje 02: los paquetes de los dos operadores compiten en UNA ranura', () => {
  it('las 24 órdenes dejan 1 ranura con 2 paquetes-opción, y el segundo entra en la ranura del primero', () => {
    for (const orden of permutaciones(Object.keys(CON_OPERADOR))) {
      const { opciones, planes } = simular(orden.map(n => CON_OPERADOR[n]))
      const nuevos = planes.filter(p => p.accion === 'nuevo_paquete')
      expect(nuevos, orden.join(', ')).toHaveLength(2)
      expect(nuevos[0].accion === 'nuevo_paquete' && nuevos[0].grupo, orden.join(', ')).toBeNull()
      expect(nuevos[1].accion === 'nuevo_paquete' && nuevos[1].grupo, orden.join(', ')).toBe('paquete de bloqueo')
      expect(new Set(opciones.map(o => o.grupo)), orden.join(', ')).toEqual(new Set(['paquete de bloqueo']))
      expect(opciones, orden.join(', ')).toHaveLength(2)
      expect(paquetes(opciones), orden.join(', ')).toEqual([
        'ALIADOS TRAVEL | LATAM 4120 | Decameron Aquarium',
        'TU RESERVA | Avianca 8410 | GHL Relax Hotel Sunrise Beach',
      ])
    }
  })

  it('las 24 órdenes: Tarifas tiene la Recomendada y la Opción 2, y ninguna suma A + B', () => {
    for (const orden of permutaciones(Object.keys(CON_OPERADOR))) {
      const { opciones } = simular(orden.map(n => CON_OPERADOR[n]))
      const { tarifas, totales } = tarifasDe(opciones)
      expect(tarifas, orden.join(', ')).toHaveLength(2)
      expect(recomendadaDe(tarifas).fila, orden.join(', ')).not.toBeNull()
      expect(tarifas.filter(t => t.nombre === null), orden.join(', ')).toHaveLength(1)
      expect(tarifas.every(t => t.vaEnPropuesta), orden.join(', ')).toBe(true)
      expect([...totales].sort((a, b) => a - b), orden.join(', ')).toEqual([9_280_000, 10_666_588])
      expect(totales, orden.join(', ')).not.toContain(19_946_588)
    }
  })

  it('cada paquete conserva su pregunta Pública / Neta: la bandeja hace dos, una por paquete', () => {
    const { opciones } = simular([AVIANCA_TR, GHL, LATAM_AL, DECAMERON])
    expect(opciones.every(o => o.paquete?.tarifaPorElegir === true)).toBe(true)
    const lineas = opciones.map(o => ({ id: o.itemId, grupo: o.grupo, orden: o.orden, paquete: o.paquete }))
    expect(paquetesConTarifaPorElegir(lineas)).toEqual([
      { itemId: 'it-1', titulo: 'Paquete 1 · Avianca 8410' },
      { itemId: 'it-2', titulo: 'Paquete 2 · LATAM 4120' },
    ])
    // Responder en uno no toca al otro (`elegirTarifaDelPaquete` escribe solo en su paquete).
    expect(opcionesDelMismoPaquete(opciones, 'it-1')).toEqual(['it-1'])
    expect(opcionesDelMismoPaquete(opciones, 'it-2')).toEqual(['it-2'])
  })

  it('un segundo hotel de Tu Reserva es otra opción de SU paquete, con su vuelo y la tarifa de su hermana', () => {
    const sol = hotel({ es_oferta_de_hotel: true, hotel: 'Sol Caribe Campo', noches: 5, operador: 'TU RESERVA', precios_por_persona: [{ acomodacion: 'doble', precio: 2_000_000 }] })
    const { opciones } = simular([AVIANCA_TR, GHL, LATAM_AL, DECAMERON])
    const publica = { tipo: 'publica' as const, comision: { tipo: 'pct' as const, valor: 10 } }
    opciones[0].tarifa = publica
    opciones[0].paquete = { ...opciones[0].paquete!, tarifaPorElegir: undefined }
    const plan = planDelPegado(opciones, sol, CTX)
    expect(plan.accion).toBe('nueva_opcion')
    if (plan.accion !== 'nueva_opcion') return
    expect(plan.grupo).toBe('paquete de bloqueo')
    expect(plan.paquete.vuelo?.tramos[0].numeroVuelo).toBe('8410')
    expect(plan.paquete.operador).toBe('TU RESERVA')
    expect(plan.tarifa).toEqual(publica)
  })
})

describe('UN operador con otro vuelo: el segundo paquete también compite (SAN ANDRÉS)', () => {
  const uno: ContextoDeArmado = { ...CTX, operadorInicial: 'TU RESERVA', operadoresSolicitud: operadoresDeLaSolicitud('TU RESERVA') }

  it('vuelo + hotel, otro vuelo + hotel: 1 ranura, 2 paquetes, cada hotel con su vuelo', () => {
    const { opciones, planes } = simular([AVIANCA, GHL, LATAM, DECAMERON], uno)
    expect(planes.map(p => p.accion)).toEqual(['nuevo_paquete', 'actualizar', 'nuevo_paquete', 'actualizar'])
    expect(new Set(opciones.map(o => o.grupo)).size).toBe(1)
    expect(paquetes(opciones)).toEqual([
      'TU RESERVA | Avianca 8410 | GHL Relax Hotel Sunrise Beach',
      'TU RESERVA | LATAM 4120 | Decameron Aquarium',
    ])
  })

  it('el hotel que llega después del segundo vuelo va al paquete de ese vuelo, no al primero', () => {
    const sol = hotel({ es_oferta_de_hotel: true, hotel: 'Sol Caribe Campo', noches: 5, precios_por_persona: [{ acomodacion: 'doble', precio: 2_000_000 }] })
    const { opciones } = simular([AVIANCA, GHL, LATAM, DECAMERON, sol], uno)
    expect(paquetes(opciones)).toEqual([
      'TU RESERVA | Avianca 8410 | GHL Relax Hotel Sunrise Beach',
      'TU RESERVA | LATAM 4120 | Decameron Aquarium + Sol Caribe Campo',
    ])
  })
})
