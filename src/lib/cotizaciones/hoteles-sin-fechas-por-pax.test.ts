/**
 * COT-2026-0004 (Trappvel, 2026-10-23) · tres hoteles alternativos de un mismo destino, cada uno
 * en dos pantallazos: «2 adultos» y «2 adultos + 1 niño», para que ONE deduzca lo que cobra el
 * hotel por el niño. Las tarjetas no mostraban las fechas (se tomaron las del viaje, 7.4) y el
 * lector escribió la ciudad como barrio o como isla, y el tipo de habitación en otro idioma.
 *
 * Lo que pasó: seis opciones sueltas en dos bloques («Hotel en Willemstad», «Hotel 3 en
 * Otrobanda»), la del niño con «Falta el costo» y la de solo adultos cobrando a dos.
 *
 * Datos FICTICIOS con la misma forma: mismos campos vacíos, misma variación de textos.
 */
import { describe, expect, it } from 'vitest'

import { agregarHabitacion, habitacionesDeTarifa, mismaOpcionHotel, resolverHabitaciones } from './habitaciones'
import { leerTarifaPax, type Composicion, type LecturaCasilla, type TarifaPax } from './tarifa-pasajero'
import { lugaresDeHotelCompatibles, ubicarLectura, type LineaParaUbicar } from './ubicar-lectura'

const VIAJE: Composicion = { adultos: 2, ninos: 1, infantes: 0 }

function lectura(a: {
  hotel: string
  ciudad: string
  habitacion: string
  conNino: boolean
  total: number
  checkIn?: string | null
  checkOut?: string | null
}): LecturaCasilla {
  const ninos = a.conNino ? 1 : 0
  return {
    moneda: 'COP',
    total: a.total,
    aPagarAgencia: null,
    porTipo: [],
    ocupacion: { adultos: 2, ninos, infantes: 0, total: 2 + ninos },
    ocupacionDelItem: false,
    // Sin fechas en la imagen: la lectura las toma del viaje y NO las pone en la identidad.
    identidad: { hotel: a.hotel, regimen: 'Todo Incluido', check_in: a.checkIn ?? null, check_out: a.checkOut ?? null, tipo_habitacion: a.habitacion },
    notasCliente: [],
    alertas: ['La captura no muestra las fechas: se toman las del viaje (2026-11-26 a 2026-12-01). Confírmalas contra el proveedor.'],
    campos: [
      { label: 'Hotel', valor: a.hotel },
      { label: 'Ciudad', valor: a.ciudad },
      { label: 'Habitación', valor: a.habitacion },
      { label: 'Check-in', valor: '2026-11-26 (del viaje)' },
      { label: 'Check-out', valor: '2026-12-01 (del viaje)' },
      { label: 'Ocupación', valor: a.conNino ? '2 adultos, 1 niño (7 años)' : '2 adultos' },
    ],
    nombre: `${a.hotel.toUpperCase()} · ${a.ciudad.toUpperCase()}`,
    descripcion: `Habitación: ${a.habitacion}`,
    leidaEn: '2026-10-23T16:04:00.000Z',
    paraComposicion: { adultos: 2, ninos, infantes: 0 },
  }
}

// Primero las tres de «2 adultos + 1 niño», después las tres de «2 adultos», como se pegaron.
const PANTALLAZOS: { id: string; l: LecturaCasilla }[] = [
  { id: 'brisa-nino', l: lectura({ hotel: 'Brisa Marina Resort', ciudad: 'Punta Arena / Isla Coral', habitacion: 'Interior room - no window, two queen beds', conNino: true, total: 9_600_000 }) },
  { id: 'palmar-nino', l: lectura({ hotel: 'Palmar Bay Resort & Spa', ciudad: 'Puerto Viejo / Isla Coral', habitacion: 'Doble deluxe con vista', conNino: true, total: 7_100_000 }) },
  { id: 'coral-nino', l: lectura({ hotel: 'Casa Coral All Inclusive Trademark', ciudad: 'Puerto Viejo / Isla Coral', habitacion: 'Habitación familiar con cama doble', conNino: true, total: 3_250_000 }) },
  { id: 'brisa-adultos', l: lectura({ hotel: 'Brisa Marina Resort', ciudad: 'Isla Coral', habitacion: 'Doble habitación sin ventana', conNino: false, total: 9_300_000 }) },
  { id: 'palmar-adultos', l: lectura({ hotel: 'Palmar Bay Resort & Spa', ciudad: 'Puerto Viejo / Isla Coral', habitacion: 'Doble deluxe con vista', conNino: false, total: 7_100_000 }) },
  { id: 'coral-adultos', l: lectura({ hotel: 'Casa Coral All Inclusive Trademark', ciudad: 'Puerto Viejo / Isla Coral', habitacion: '1 x 1 double bed, non-smoking', conNino: false, total: 2_880_000 }) },
]

/** «Aceptar los 6» en el servidor, en memoria: cada uno contra lo que dejó el anterior. */
function aceptarEnOrden(pantallazos: readonly { id: string; l: LecturaCasilla }[]) {
  let lineas: (LineaParaUbicar & { tarifa_pax: TarifaPax })[] = []
  let bloques = 0
  const sobrantes: string[] = []
  for (const { id, l } of pantallazos) {
    const pista = { lugar: l.campos.find(c => c.label === 'Ciudad')?.valor ?? null, origen: null, destino: null }
    const d = ubicarLectura({ tipo: 'hotel', lectura: l, pistas: pista, lineas, grupoViaje: VIAJE })
    if (d.como === 'habitacion') {
      if (d.sobra) { sobrantes.push(id); continue }
      lineas = lineas.map(x => (x.id === d.itemId ? { ...x, tarifa_pax: agregarHabitacion(x.tarifa_pax, { id, lectura: l }, VIAJE) } : x))
    } else if (d.como === 'hermana') {
      lineas = [...lineas, { id, grupo: d.grupo, nombre: l.nombre, tarifa_pax: { casillas: { grupo_completo: l } } }]
    } else {
      bloques++
      lineas = [...lineas, { id, grupo: bloques === 1 ? 'hotel' : `hotel ${bloques}`, nombre: l.nombre, tarifa_pax: { casillas: { grupo_completo: l } } }]
    }
  }
  return { lineas, bloques, sobrantes }
}

describe('COT-2026-0004 · pantallazos por pasajero del mismo hotel, sin fechas en la imagen', () => {
  it('los seis quedan en UN bloque con tres opciones, una por hotel, cada una con sus dos pantallazos', () => {
    const { lineas, bloques, sobrantes } = aceptarEnOrden(PANTALLAZOS)
    expect(sobrantes).toEqual([])
    expect(bloques).toBe(1)
    expect(lineas.map(l => l.id)).toEqual(['brisa-nino', 'palmar-nino', 'coral-nino'])
    expect(lineas.map(l => l.grupo)).toEqual(['hotel', 'hotel', 'hotel'])
    expect(lineas.map(l => habitacionesDeTarifa(leerTarifaPax(l.tarifa_pax)).length)).toEqual([2, 2, 2])
  })

  it('cada opción tiene costo y el del niño sale de restar la de solo adultos, aunque el tipo de habitación se lea distinto', () => {
    const { lineas } = aceptarEnOrden(PANTALLAZOS)
    const porHotel = Object.fromEntries(lineas.map(l => [l.id, resolverHabitaciones(leerTarifaPax(l.tarifa_pax), VIAJE)]))
    for (const r of Object.values(porHotel)) expect(r.estado).toBe('resuelta')
    const costos = (id: string) => {
      const r = porHotel[id]
      if (r.estado !== 'resuelta') throw new Error(r.estado)
      return { total: r.costoTotal, porTipo: Object.fromEntries(r.costos.map(c => [c.tipo, c.total])) }
    }
    // Lo que se cobra es la habitación de los tres; la de solo adultos solo sirve para restar.
    expect(costos('brisa-nino')).toEqual({ total: 9_600_000, porTipo: { adulto: 9_300_000, nino: 300_000 } })
    expect(costos('palmar-nino')).toEqual({ total: 7_100_000, porTipo: { adulto: 7_100_000, nino: 0 } })
    expect(costos('coral-nino')).toEqual({ total: 3_250_000, porTipo: { adulto: 2_880_000, nino: 370_000 } })
  })

  it('en el orden inverso (primero solo adultos) también se juntan', () => {
    const { bloques, lineas, sobrantes } = aceptarEnOrden([...PANTALLAZOS].reverse())
    expect(sobrantes).toEqual([])
    expect(bloques).toBe(1)
    expect(lineas).toHaveLength(3)
    for (const l of lineas) expect(resolverHabitaciones(leerTarifaPax(l.tarifa_pax), VIAJE).estado).toBe('resuelta')
  })
})

describe('mismo hotel, sin fechas leídas', () => {
  const base = PANTALLAZOS[0].l
  it('sin fechas en ninguna, decide el hotel', () => {
    expect(mismaOpcionHotel(base, PANTALLAZOS[3].l)).toBe(true)
    expect(mismaOpcionHotel(base, PANTALLAZOS[1].l)).toBe(false)
  })
  it('fechas leídas en las dos y distintas: otra estadía, no se junta', () => {
    const a = { ...base, identidad: { ...base.identidad, check_in: '2026-11-26', check_out: '2026-12-01' } }
    const b = { ...base, identidad: { ...base.identidad, check_in: '2026-12-10', check_out: '2026-12-12' } }
    expect(mismaOpcionHotel(a, b)).toBe(false)
    expect(mismaOpcionHotel(a, { ...b, identidad: { ...b.identidad, check_in: '2026-11-26', check_out: '2026-12-01' } })).toBe(true)
  })
  it('sin hotel no se afirma', () => {
    expect(mismaOpcionHotel({ ...base, identidad: { ...base.identidad, hotel: null } }, base)).toBe(false)
  })
})

describe('la habitación que sí cobra no se resta con otro tipo', () => {
  it('4 adultos y 1 niño: una suite de 2 adultos y una doble con el niño cobran las dos, sin partir el precio', () => {
    const suite = lectura({ hotel: 'Palmar Bay Resort & Spa', ciudad: 'Isla Coral', habitacion: 'Suite vista al mar', conNino: false, total: 5_000_000 })
    const doble = lectura({ hotel: 'Palmar Bay Resort & Spa', ciudad: 'Isla Coral', habitacion: 'Doble estándar', conNino: true, total: 3_000_000 })
    const grupo: Composicion = { adultos: 4, ninos: 1, infantes: 0 }
    const t = agregarHabitacion({ casillas: { grupo_completo: suite } }, { id: 'doble', lectura: doble }, grupo)
    const r = resolverHabitaciones(t, grupo)
    expect(r).toMatchObject({ estado: 'resuelta', costoTotal: 8_000_000, costos: [] })
  })
})

describe('lugares de hotel por partes', () => {
  it('barrio / isla contra otro barrio de la misma isla, o la isla sola', () => {
    expect(lugaresDeHotelCompatibles('Punta Arena / Isla Coral', 'Puerto Viejo / Isla Coral')).toBe(true)
    expect(lugaresDeHotelCompatibles('Isla Coral', 'Punta Arena / Isla Coral')).toBe(true)
    expect(lugaresDeHotelCompatibles('Otrobanda / Curaçao', 'Willemstad / Curacao')).toBe(true)
  })
  it('dos ciudades del mismo país grande no son el mismo destino', () => {
    expect(lugaresDeHotelCompatibles('Cartagena / Colombia', 'San Andrés / Colombia')).toBe(false)
    expect(lugaresDeHotelCompatibles('Cartagena', 'San Andrés')).toBe(false)
    expect(lugaresDeHotelCompatibles(null, 'San Andrés')).toBeNull()
  })
})
