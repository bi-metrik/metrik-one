/**
 * Hotel de varias habitaciones en UN pantallazo con un precio total (decisión de Mauricio,
 * 2026-10-14: «mostramos el precio total y dejamos el registro de varias habitaciones»).
 *
 * Las lecturas de `__fixtures__/reserva-varias-habitaciones.json` son REALES (gemini-2.5-flash,
 * 2026-10-14) sobre los pantallazos sintéticos de la verificación D de Vera. La de siempre dejó la
 * Posada (3 dobles, total $1.229.098) en «¿Cuál de estas?» en 2 de 3 corridas; con la reserva, el
 * modelo la leyó como una opción en 10 de 10 (Posada, Verde Mar, Lord Pierre, Agua Dulce), y la
 * grilla para elegir siguió en RX1 en 2 de 2.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import fixture from './__fixtures__/reserva-varias-habitaciones.json'
import { evaluarLectura, type LecturaCruda } from './lectura-pantallazo'
import { construirLecturaCasilla } from './lectura-casilla'
import { ranuraPorSlug } from './ranuras-pantallazo'
import { composicionDeLectura } from './tarifa-pasajero'
import {
  composicionDeTexto,
  ocupacionDeReserva,
  registroDeReserva,
  reservaDeVariasHabitaciones,
  resumenDeReserva,
} from './reserva-habitaciones'
import { acomodacionDeReserva } from './tarjeta-opcion'

vi.mock('server-only', () => ({}))

const HOTEL = ranuraPorSlug('hotel_detalle')!
const CONTEXTO = { soloMinimosDeCosto: true, monedaSiFalta: 'COP', hoy: '2026-10-14' }
const cruda = (x: unknown) => structuredClone(x) as LecturaCruda

describe('la prueba que fallaba: una reserva de 3 habitaciones con un total', () => {
  it('con la lectura de siempre queda en «¿Cuál de estas?» (RX1 con las 3 dobles para elegir)', () => {
    const corridas = fixture.posadaSiempre.map(c => evaluarLectura(HOTEL, cruda(c), CONTEXTO))
    const rechazos = corridas.filter(v => !v.ok)
    expect(rechazos.length).toBe(2)
    for (const v of rechazos) {
      expect(v).toMatchObject({
        ok: false,
        codigo: 'RX1',
        opciones: [
          { nombre: 'Doble 1', precio: 'COP 409.699' },
          { nombre: 'Doble 2', precio: 'COP 409.699' },
          { nombre: 'Doble 3', precio: 'COP 409.700' },
        ],
      })
    }
    // La que sí pasó, pasó sin registro: «Doble» a secas, y nadie sabe que son tres.
    const pasa = corridas.find(v => v.ok)
    expect(pasa && pasa.ok && pasa.habitacionesReserva).toBeUndefined()
  })

  it('con la reserva es UNA opción: costo = el total, y el registro de las 3 habitaciones', () => {
    const v = evaluarLectura(HOTEL, cruda(fixture.posadaReserva), CONTEXTO)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const l = construirLecturaCasilla(HOTEL, v, '2026-10-14T20:00:00.000Z')
    expect(l.total).toBe(1_229_098)
    expect(l.moneda).toBe('COP')
    expect(l.porTipo).toEqual([])
    expect(composicionDeLectura(l)).toEqual({ adultos: 6, ninos: 1, infantes: 1 })
    expect(l.habitacionesReserva).toEqual([
      { nombre: 'Doble 1', ocupacion: '2 adultos', precio: 409_699 },
      { nombre: 'Doble 2', ocupacion: '2 adultos', precio: 409_699 },
      { nombre: 'Doble 3', ocupacion: '2 adultos, 1 niño, 1 infante', precio: 409_700 },
    ])
    expect(l.identidad.tipo_habitacion).toBe('3 habitaciones dobles')
    expect(l.descripcion).toContain('Habitación: 3 habitaciones dobles')
    expect(acomodacionDeReserva(registroDeReserva(l))).toBe('Doble 1: 2 adultos; Doble 2: 2 adultos; Doble 3: 2 adultos + 1 niño + 1 infante')
  })

  it('Verde Mar (2 cuádruples, total sin decir cuántas): una opción de $5.712.000', () => {
    const v = evaluarLectura(HOTEL, cruda(fixture.verdeMarReserva), CONTEXTO)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const l = construirLecturaCasilla(HOTEL, v, '2026-10-14T20:00:00.000Z')
    expect(l.total).toBe(5_712_000)
    expect(l.identidad.tipo_habitacion).toBe('2 habitaciones cuádruples')
    expect(composicionDeLectura(l)).toEqual({ adultos: 6, ninos: 1, infantes: 1 })
  })

  it('una grilla para ELEGIR habitación (sin total) sigue en «¿Cuál de estas?»', () => {
    const v = evaluarLectura(HOTEL, cruda(fixture.eligeHabitacionReserva), CONTEXTO)
    expect(v).toMatchObject({ ok: false, codigo: 'RX1' })
  })
})

describe('el modelo no se cree solo: la suma de las habitaciones tiene que dar el total', () => {
  it('detalle único con las habitaciones contadas como opciones: pasa si suman el total', () => {
    const c = cruda(fixture.posadaReserva)
    c.opcionesVistas = [
      { nombre: 'Doble 1', precio: 'COP 409.699', seleccionada: false },
      { nombre: 'Doble 2', precio: 'COP 409.699', seleccionada: false },
      { nombre: 'Doble 3', precio: 'COP 409.700', seleccionada: false },
    ]
    c.opcionesVisibles = 3
    expect(evaluarLectura(HOTEL, c, CONTEXTO).ok).toBe(true)
  })

  it('si no suman el total, la contradicción manda: RX1', () => {
    const c = cruda(fixture.posadaReserva)
    c.habitacionesReserva![2].precio = 'COP 900.000'
    c.opcionesVisibles = 3
    expect(evaluarLectura(HOTEL, c, CONTEXTO)).toMatchObject({ ok: false, codigo: 'RX1' })
    // Y con una sola opción vista, entra como una lectura más, sin registro.
    c.opcionesVisibles = 1
    const v = evaluarLectura(HOTEL, c, CONTEXTO)
    expect(v.ok && v.habitacionesReserva).toBeUndefined()
  })

  it('reservaDeVariasHabitaciones', () => {
    const h = (nombre: string, precio: string | null, ocupacion: string | null = null) => ({ nombre, precio, ocupacion })
    expect(reservaDeVariasHabitaciones([h('Doble 1', '409.699'), h('Doble 2', '409.699'), h('Doble 3', '409.700')], 1_229_098)).toHaveLength(3)
    // Redondeo del proveedor: hasta una unidad por habitación.
    expect(reservaDeVariasHabitaciones([h('Doble 1', '409.699'), h('Doble 2', '409.699')], 819_400)).toHaveLength(2)
    expect(reservaDeVariasHabitaciones([h('Doble 1', '409.699'), h('Doble 2', '409.699')], 819_401)).toBeNull()
    // Sin precio por habitación, el total es lo único que hay.
    expect(reservaDeVariasHabitaciones([h('Doble 1', null), h('Doble 2', null)], 800_000)).toHaveLength(2)
    // Unas con precio y otras sin él: no se afirma.
    expect(reservaDeVariasHabitaciones([h('Doble 1', '400.000'), h('Doble 2', null)], 800_000)).toBeNull()
    // Una sola habitación no es una reserva de varias; sin total, tampoco.
    expect(reservaDeVariasHabitaciones([h('Doble 1', '400.000')], 400_000)).toBeNull()
    expect(reservaDeVariasHabitaciones([h('Doble 1', null), h('Doble 2', null)], null)).toBeNull()
  })
})

describe('lo que se muestra', () => {
  const r = (nombres: string[]) => nombres.map(nombre => ({ nombre, ocupacion: null, precio: null }))
  it('resumenDeReserva', () => {
    expect(resumenDeReserva(r(['Doble 1', 'Doble 2', 'Doble 3']), 'Doble')).toBe('3 habitaciones dobles')
    expect(resumenDeReserva(r(['Cuádruple 1', 'Cuádruple 2']), null)).toBe('2 habitaciones cuádruples')
    expect(resumenDeReserva(r(['Doble 1', 'Doble 2', 'Triple']), null)).toBe('3 habitaciones: 2 dobles y 1 triple')
    expect(resumenDeReserva(r(['Suite', 'Suite']), null)).toBe('2 habitaciones suites')
    expect(resumenDeReserva(r(['Habitación 1', 'Habitación 2']), 'Superior')).toBe('2 habitaciones · Superior')
    expect(resumenDeReserva(r(['Habitación 1', 'Habitación 2']), null)).toBe('2 habitaciones')
  })

  it('composicionDeTexto y ocupacionDeReserva', () => {
    expect(composicionDeTexto('2 adultos, 1 niño, 1 infante')).toEqual({ adultos: 2, ninos: 1, infantes: 1 })
    expect(composicionDeTexto('2 Adults · 1 child (0 years)')).toEqual({ adultos: 2, ninos: 0, infantes: 1 })
    expect(composicionDeTexto('Alojamiento y desayuno')).toBeNull()
    expect(ocupacionDeReserva([
      { nombre: 'A', ocupacion: '4 adultos', precio: null },
      { nombre: 'B', ocupacion: '2 adultos, 1 niño, 1 infante', precio: null },
    ])).toEqual({ adultos: 6, ninos: 1, infantes: 1 })
    expect(ocupacionDeReserva([{ nombre: 'A', ocupacion: '4 adultos', precio: null }, { nombre: 'B', ocupacion: null, precio: null }])).toBeNull()
  })
})

describe('con el interruptor apagado el lector es el de siempre, byte a byte', () => {
  // Hash del prompt y del esquema que salen hacia Gemini (lectura normal + lectura con una opción
  // ya elegida), medido sobre `origin/main` (ed66eb76) antes de este cambio.
  const DE_MAIN: Record<string, string> = {
    vuelo_detalle: '18cbfb1f8bf8d0a817f01bd37924f72567a6a8469683bbb74645080f9096e810',
    // QA Trappvel G7 (2026-10-29, V7-2): el hotel lee además el concepto del cargo en destino y si
    // es por noche (`impuestos_destino_concepto`, `impuestos_destino_base`). Cambio buscado del lector.
    hotel_detalle: '961bcc13cc71166a17dc930d75da63720ebcfa847a11a2d22db760fee9c1abaa',
    actividad_detalle: '226ce269035055eae7085e9ddfd2d57b3d6ac44e8029eba5d026309d4be9ef8b',
    traslado_detalle: 'c6166410ec33220ba1d1c0ba1185815325cab98f9529907e8a9571321e009927',
    otro_detalle: 'b2450381b66f3ec58e7cd98923a6c042e122625ed9fe01b4f2c2f92bd34088d6',
  }

  async function cuerposHaciaGemini(slug: string, opciones?: { reservaVariasHabitaciones: boolean }) {
    const { extraerRanuraDesdeImagen } = await import('@/lib/ai/extraer-ranura')
    const cuerpos: string[] = []
    const fetchReal = globalThis.fetch
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      const b = JSON.parse(init.body)
      const texto = b.system_instruction?.parts?.[0]?.text ?? ''
      if (texto.includes('RANURA DE ESTA CAPTURA')) cuerpos.push(JSON.stringify({ p: texto, s: b.generationConfig.responseSchema }))
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"veredicto":"no_es_pantalla_de_precio"}' }] } }] }), { status: 200 })
    }) as never
    try {
      // Un PNG de 1×1: la lectura no pasa del fetch.
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
      const ranura = ranuraPorSlug(slug)!
      if (opciones) {
        await extraerRanuraDesdeImagen(png, 'image/png', ranura, 'k', null, opciones)
        await extraerRanuraDesdeImagen(png, 'image/png', ranura, 'k', { nombre: 'Suite', precio: '1 COP' }, opciones)
      } else {
        await extraerRanuraDesdeImagen(png, 'image/png', ranura, 'k')
        await extraerRanuraDesdeImagen(png, 'image/png', ranura, 'k', { nombre: 'Suite', precio: '1 COP' })
      }
    } finally {
      globalThis.fetch = fetchReal
    }
    return cuerpos
  }
  const hash = (c: string[]) => createHash('sha256').update(c.join('\n')).digest('hex')

  it.each(Object.keys(DE_MAIN))('%s: sin opciones, igual a main', async slug => {
    expect(hash(await cuerposHaciaGemini(slug))).toBe(DE_MAIN[slug])
  })

  it('con la reserva, el hotel lleva el bloque y la propiedad; las demás ranuras no cambian', async () => {
    const hotel = await cuerposHaciaGemini('hotel_detalle', { reservaVariasHabitaciones: true })
    expect(hash(hotel)).not.toBe(DE_MAIN.hotel_detalle)
    expect(hotel[0]).toContain('UNA RESERVA DE VARIAS HABITACIONES NO ES')
    expect(hotel[0]).toContain('habitaciones_reserva')
    for (const slug of ['vuelo_detalle', 'actividad_detalle', 'traslado_detalle', 'otro_detalle']) {
      expect(hash(await cuerposHaciaGemini(slug, { reservaVariasHabitaciones: true })), slug).toBe(DE_MAIN[slug])
    }
    expect(hash(await cuerposHaciaGemini('hotel_detalle', { reservaVariasHabitaciones: false }))).toBe(DE_MAIN.hotel_detalle)
  })
})
