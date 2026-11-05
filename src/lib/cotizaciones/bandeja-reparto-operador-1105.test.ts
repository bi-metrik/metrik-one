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
import { MENSAJE_VUELO_VARIOS_OPERADORES, planDelPegado, type ContextoDeArmado, type LecturaParaArmar, type OpcionDeBloqueo, type PlanDeArmado } from './bloqueo-armado'
import { hotelDesdeLectura, vueloDesdeLectura } from './bloqueo-extraccion'
import { operadorInicialDelPaquete, operadoresDeLaSolicitud } from './bloqueo-operador'

// ── Lo que «respondió» el modelo a cada pantallazo ─────────────────────────────

function hotel(raw: unknown): LecturaParaArmar {
  const h = hotelDesdeLectura(raw)
  if (!h.ok) throw new Error(h.motivo)
  return { cual: 'hotel', hotel: h.hotel, incluye: h.incluye, operador: h.operador }
}
function vuelo(raw: unknown): LecturaParaArmar {
  const v = vueloDesdeLectura(raw)
  if (!v.ok) throw new Error(v.motivo)
  return { cual: 'vuelo', vuelo: v.vuelo }
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

/** Aplica los planes sobre una cotización en memoria, como lo haría `pegarEnBloqueo`. */
function simular(lecturas: LecturaParaArmar[], ctx = CTX) {
  const opciones: OpcionDeBloqueo[] = []
  const planes: PlanDeArmado[] = []
  for (const l of lecturas) {
    const p = planDelPegado(opciones, l, ctx)
    planes.push(p)
    if (p.accion === 'nuevo_paquete') {
      const numero = opciones.length ? Math.max(...opciones.map(o => o.numero)) + 1 : 1
      opciones.push({ itemId: `it-${opciones.length + 1}`, grupo: `paquete ${numero}`, numero, paquete: p.paquete, tarifa: p.tarifa })
    } else if (p.accion === 'nueva_opcion') {
      const numero = opciones.find(o => o.grupo === p.grupo)!.numero
      opciones.push({ itemId: `it-${opciones.length + 1}`, grupo: p.grupo, numero, paquete: p.paquete, tarifa: p.tarifa })
    } else if (p.accion === 'actualizar') {
      for (const c of p.cambios) opciones.find(o => o.itemId === c.itemId)!.paquete = c.paquete
    }
  }
  return { opciones, planes }
}

/** Cada paquete como lo vería la asesora: «operador | vuelo | hoteles». Ordenado: no depende del número. */
function paquetes(opciones: readonly OpcionDeBloqueo[]): string[] {
  const grupos = new Map<string, OpcionDeBloqueo[]>()
  for (const o of opciones) grupos.set(o.grupo, [...(grupos.get(o.grupo) ?? []), o])
  return [...grupos.values()].map(os => {
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
    expect(decameron.grupo).not.toBe(ghl.grupo)
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
    expect(new Set(opciones.map(o => o.grupo)).size).toBe(4)
    expect(planes[2]).toMatchObject({ accion: 'nuevo_paquete', mensaje: 'Paquete nuevo con Hotel Sin Logo. No se vio de qué operador es: elígelo en el paquete.' })
  })

  it('un operador leído que no es de la solicitud (la marca del hotel) cuenta como no leído', () => {
    const { opciones } = simular([GHL, hotel({ ...ghlRaw, hotel: 'Decameron Isleño', operador: 'Decameron' })])
    expect(new Set(opciones.map(o => o.grupo)).size).toBe(2)
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
