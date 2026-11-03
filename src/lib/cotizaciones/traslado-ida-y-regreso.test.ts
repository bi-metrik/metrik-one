/**
 * Brief del 2026-10-29, punto 4 (COT-2026-0008) · la lectura de un traslado, pura (sin Gemini), en
 * las cuatro formas que vio Alejandra:
 *  1. el «Resumen» de Civitatis con ida y regreso → UN traslado, dos trayectos, la suma;
 *  2. la tarjeta del carro («Turismo de 4 plazas», sin ruta ni fecha) → se sigue rechazando;
 *  3. dos capturas sueltas, una por trayecto → cada una es el traslado de siempre;
 *  4. trayectos que NO son el uno inverso del otro → siguen preguntando «¿cuál?».
 * Más el listado de vehículos (sigue en RX1) y el documento: dos trayectos con su fecha y su hora.
 */
import { describe, expect, it } from 'vitest'

import { evaluarLectura, type Aceptacion, type LecturaCruda, type Rechazo } from './lectura-pantallazo'
import { ranuraPorSlug } from './ranuras-pantallazo'
import { trasladoDeIdaYRegreso } from './traslado-ida-y-regreso'
import { trayectosDeTraslado } from './propuesta/trayectos'
import { construirPrompt, normalizarRespuesta } from '@/lib/ai/extraer-ranura'

const TRASLADO = ranuraPorSlug('traslado_detalle')!
const v = (value: string | null, confidence = 0.95) => ({ value, confidence })
const CTX = { hoy: '2026-10-29', fechasViaje: { inicio: '2027-06-21', fin: '2027-07-04' } }

const AEROPUERTO = 'Aeropuerto Internacional Ficticio (CUR)'
const CIUDAD = 'Willemstad Ciudad'

function cruda(extra: Partial<LecturaCruda> = {}, campos: Record<string, ReturnType<typeof v>> = {}): LecturaCruda {
  return {
    veredicto: 'detalle_unico',
    observacion: null,
    campos: {
      proveedor: v('Operador Ficticio'),
      trayecto: v(`${AEROPUERTO} - ${CIUDAD}`),
      tipo_vehiculo: v('Turismo de 4 plazas · privado'),
      fecha_hora: v('--06-26/sab'),
      pax: v('2'),
      moneda: v('COP'),
      precio_total: v('176456.80'),
      base_precio: v('total'),
      ...campos,
    },
    desglose: [],
    opcionesVisibles: 1,
    ...extra,
  }
}

const valor = (r: Aceptacion, slug: string) => r.campos.find(c => c.slug === slug)?.valor ?? null

describe('1 · el resumen con ida y regreso: un solo traslado', () => {
  const resumen = cruda({
    trayectosReserva: [
      { desde: AEROPUERTO, hasta: CIUDAD, fecha: '--06-26/sab', hora: '13:20', precio: '$176.456,80' },
      { desde: CIUDAD, hasta: AEROPUERTO, fecha: '--06-30/mie', hora: '05:10', precio: '$176.456,80' },
    ],
  })

  it('se acepta sin preguntar, con dos trayectos, su fecha y hora, y la suma', () => {
    const r = evaluarLectura(TRASLADO, resumen, CTX)
    expect(r.ok).toBe(true)
    const a = r as Aceptacion
    expect(valor(a, 'trayecto')).toBe(`${AEROPUERTO} -> ${CIUDAD} y ${CIUDAD} -> ${AEROPUERTO}`)
    expect(valor(a, 'fecha_hora')).toBe('2027-06-26 13:20 y 2027-06-30 05:10')
    expect(Number(valor(a, 'precio_total'))).toBe(352913.6)
    expect(a.avisos.some(x => x.startsWith('Traslado de ida y regreso'))).toBe(true)
  })

  it('aunque el modelo lo haya llamado «varias opciones», no hay nada que escoger', () => {
    const r = evaluarLectura(TRASLADO, { ...resumen, veredicto: 'varias_opciones', opcionesVisibles: 2 }, CTX)
    expect(r.ok).toBe(true)
  })

  it('el documento lo imprime como dos trayectos, cada uno con su fecha y su hora', () => {
    const a = evaluarLectura(TRASLADO, resumen, CTX) as Aceptacion
    const t = trayectosDeTraslado({ trayecto: valor(a, 'trayecto'), vehiculo: valor(a, 'tipo_vehiculo'), fecha: valor(a, 'fecha_hora') })
    expect(t.map(x => [x.fecha, x.hora])).toEqual([['26 jun 2027', '13:20'], ['30 jun 2027', '05:10']])
    expect(t[1].descripcion).toMatch(/^Willemstad Ciudad - Aeropuerto/)
  })
})

describe('2 · la tarjeta del carro se sigue rechazando', () => {
  it('sin ruta ni fecha: falta el trayecto (RX2)', () => {
    const r = evaluarLectura(TRASLADO, cruda({}, { trayecto: v(null, 0), fecha_hora: v(null, 0) }), CTX) as Rechazo
    expect(r.ok).toBe(false)
    expect(r.codigo).toBe('RX2')
  })

  it('un listado de varios vehículos o precios sigue siendo «¿cuál?» (RX1)', () => {
    const r = evaluarLectura(TRASLADO, cruda({
      veredicto: 'varias_opciones',
      opcionesVisibles: 3,
      opcionesVistas: [
        { nombre: 'Turismo de 4 plazas', precio: '$176.456', seleccionada: false },
        { nombre: 'Monovolumen de 7 plazas', precio: '$240.000', seleccionada: false },
        { nombre: 'Minibús de 15 plazas', precio: '$410.000', seleccionada: false },
      ],
    }), CTX) as Rechazo
    expect(r.codigo).toBe('RX1')
    expect(r.opciones).toHaveLength(3)
  })
})

describe('3 · dos capturas sueltas: cada una es el traslado de siempre', () => {
  it('la ida sola y el regreso solo se aceptan cada uno, sin juntar nada', () => {
    const ida = evaluarLectura(TRASLADO, cruda({ trayectosReserva: [{ desde: AEROPUERTO, hasta: CIUDAD, fecha: '--06-26/sab', hora: '13:20', precio: '176456.80' }] }), CTX) as Aceptacion
    const regreso = evaluarLectura(TRASLADO, cruda({}, { trayecto: v(`${CIUDAD} - ${AEROPUERTO}`), fecha_hora: v('--06-30/mie') }), CTX) as Aceptacion
    expect([ida.ok, regreso.ok]).toEqual([true, true])
    expect(valor(ida, 'trayecto')).toBe(`${AEROPUERTO} - ${CIUDAD}`)
    expect(valor(ida, 'precio_total')).toBe('176456.80')
    expect(valor(regreso, 'fecha_hora')).toBe('2027-06-30')
  })
})

describe('lo que se le pide al modelo', () => {
  it('solo la forma por pasos y solo el traslado llevan el bloque de los trayectos', () => {
    expect(construirPrompt(TRASLADO, null, { trasladoIdaYRegreso: true })).toContain('"trayectos_reserva"')
    // Apagado, el prompt de siempre (lo vigila byte a byte `reserva-habitaciones.test.ts`).
    expect(construirPrompt(TRASLADO)).not.toContain('trayectos_reserva')
    expect(construirPrompt(ranuraPorSlug('hotel_detalle')!, null, { trasladoIdaYRegreso: true })).not.toContain('trayectos_reserva')
  })

  it('la respuesta trae los trayectos; sin la propiedad, la lectura es la de siempre', () => {
    const base = { veredicto: 'detalle_unico', campos: {}, desglose: [], opciones_vistas: [{ nombre: 'Reserva', precio: '352.913,60' }] }
    const con = normalizarRespuesta({ ...base, trayectos_reserva: [{ desde: 'A', hasta: 'B', fecha: '--06-26', hora: '13:20', precio: '1' }, { desde: 'B', hasta: 'A', fecha: '--06-30', hora: '05:10', precio: '1' }] })
    expect(con.trayectosReserva?.map(t => [t.desde, t.hasta, t.hora])).toEqual([['A', 'B', '13:20'], ['B', 'A', '05:10']])
    expect('trayectosReserva' in normalizarRespuesta(base)).toBe(false)
  })
})

describe('4 · trayectos que no son ida y regreso siguen preguntando', () => {
  it('aeropuerto → hotel A → hotel B: «¿cuál trayecto?» con los dos', () => {
    const r = evaluarLectura(TRASLADO, cruda({
      trayectosReserva: [
        { desde: AEROPUERTO, hasta: 'Hotel Ficticio A', fecha: '--06-26', hora: '13:20', precio: '100000' },
        { desde: 'Hotel Ficticio A', hasta: 'Hotel Ficticio B', fecha: '--06-28', hora: '10:00', precio: '90000' },
      ],
    }), CTX) as Rechazo
    expect(r.ok).toBe(false)
    expect(r.codigo).toBe('RX1')
    expect(r.opciones?.map(o => o.nombre)).toEqual([`${AEROPUERTO} → Hotel Ficticio A`, 'Hotel Ficticio A → Hotel Ficticio B'])
  })

  it('tres trayectos, aunque el último vuelva al inicio, tampoco se juntan', () => {
    expect(trasladoDeIdaYRegreso([
      { desde: 'A', hasta: 'B', fecha: null, hora: null, precio: '1' },
      { desde: 'B', hasta: 'C', fecha: null, hora: null, precio: '1' },
      { desde: 'C', hasta: 'A', fecha: null, hora: null, precio: '1' },
    ])).toBeNull()
  })

  it('ida y regreso sin precio legible en uno: no se suma a ciegas', () => {
    expect(trasladoDeIdaYRegreso([
      { desde: 'A', hasta: 'B', fecha: null, hora: null, precio: '176.456,80' },
      { desde: 'B', hasta: 'A', fecha: null, hora: null, precio: null },
    ])).toBeNull()
  })

  it('los extremos se comparan sin tildes ni signos', () => {
    expect(trasladoDeIdaYRegreso([
      { desde: 'Aeropuerto (CUR)', hasta: 'Willemstad', fecha: null, hora: null, precio: '10' },
      { desde: 'WILLEMSTAD', hasta: 'aeropuerto CUR', fecha: null, hora: null, precio: '10' },
    ])?.total).toBe(20)
  })
})
