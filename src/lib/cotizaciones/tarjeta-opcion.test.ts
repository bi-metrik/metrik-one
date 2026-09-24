import { describe, expect, it } from 'vitest'

import { costoPorTipoDeHabitaciones, precioPorHabitacion, repartirHabitaciones } from './habitaciones'
import { precioPorPasajero, type Habitacion, type LecturaCasilla, type PreciosAMano, type TarifaConfirmada } from './tarifa-pasajero'
import {
  fechasDeEstadia,
  filasDeCosto,
  notaDeEdad,
  notaDeReferencia,
  ocupacionConEdades,
  precioDeLineaConManuales,
  resumenDeAlojamiento,
  totalesDeFilas,
} from './tarjeta-opcion'

// Los datos del prototipo: Cabañas Agua Dulce, grupo de 6 adultos, 1 niño y 1 infante, margen 15 %.
const GRUPO = { adultos: 6, ninos: 1, infantes: 1 }
const CONFIRMADA: TarifaConfirmada = {
  composicion: GRUPO,
  costos: [
    { tipo: 'adulto', cantidad: 6, unitarioCOP: 634000, totalCOP: 3804000 },
    { tipo: 'nino', cantidad: 1, unitarioCOP: 151400, totalCOP: 151400 },
    { tipo: 'infante', cantidad: 1, unitarioCOP: 22000, totalCOP: 22000 },
  ],
  costoTotalCOP: 3977400,
  moneda: 'COP',
  tasa: null,
  confirmadaEn: '2026-09-24T00:00:00Z',
}
// La cascada: 3.977.400 / 0,85, al peso.
const PRECIO_LINEA = Math.round(3977400 / 0.85)
const AHORA = '2026-09-24T12:00:00Z'
const aMano = (precios: Record<string, number>): PreciosAMano =>
  Object.fromEntries(Object.entries(precios).map(([k, precio]) => [k, { precio, por: 'Alejandra', porId: 'p1', en: AHORA }]))

describe('la tabla de costo y precio', () => {
  it('una fila por tipo de pasajero, con el precio que sale del margen (como el prototipo)', () => {
    const filas = filasDeCosto({ confirmada: CONFIRMADA, precioLinea: PRECIO_LINEA })
    expect(filas.map(f => [f.nombre, f.cantidad, f.costoUnitario, f.precioUnitario])).toEqual([
      ['Adulto', 6, 634000, 745882],
      ['Niño', 1, 151400, 178118],
      ['Infante', 1, 22000, 25882],
    ])
    expect(filas.every(f => !f.aMano && !f.bajoCosto)).toBe(true)
  })

  it('las filas suman exactamente el precio de la línea (los totales del prototipo, al peso)', () => {
    const filas = filasDeCosto({ confirmada: CONFIRMADA, precioLinea: PRECIO_LINEA })
    expect(filas.map(f => f.precioTotal)).toEqual([4475294, 178118, 25882])
    expect(totalesDeFilas(filas).precio).toBe(PRECIO_LINEA)
  })

  it('un precio a mano se queda; las demás filas se reparten lo que queda', () => {
    const filas = filasDeCosto({ confirmada: CONFIRMADA, precioLinea: 4404000, preciosAMano: aMano({ adulto: 700000 }) })
    const adulto = filas.find(f => f.clave === 'adulto')!
    expect(adulto).toMatchObject({ precioUnitario: 700000, aMano: true })
    expect(totalesDeFilas(filas).precio).toBe(4404000)
  })

  it('un precio a mano por debajo del costo se marca', () => {
    const filas = filasDeCosto({ confirmada: CONFIRMADA, precioLinea: 3900000, preciosAMano: aMano({ adulto: 600000 }) })
    expect(filas.find(f => f.clave === 'adulto')?.bajoCosto).toBe(true)
  })

  it('sin par para restar, una fila por habitación con su ocupación en la etiqueta', () => {
    const porHabitacion: TarifaConfirmada = {
      ...CONFIRMADA, costos: [], costoTotalCOP: 2400000,
      porHabitacion: [
        { numero: 1, ocupacion: { adultos: 2, ninos: 1, infantes: 0 }, totalCOP: 1400000 },
        { numero: 2, ocupacion: { adultos: 2, ninos: 0, infantes: 0 }, totalCOP: 1000000 },
      ],
    }
    const filas = filasDeCosto({ confirmada: porHabitacion, precioLinea: 2823529 })
    expect(filas.map(f => [f.nombre, f.det, f.cantidad])).toEqual([
      ['Habitación 1', '2 adultos + 1 niño', 1],
      ['Habitación 2', '2 adultos', 1],
    ])
    expect(totalesDeFilas(filas).precio).toBe(2823529)
  })

  it('los adicionales van al final, con su propio precio', () => {
    const filas = filasDeCosto({
      confirmada: CONFIRMADA,
      precioLinea: PRECIO_LINEA,
      adicionales: [{ id: 'ad1', codigo: null, nombre: 'Traslado aeropuerto al hotel', cantidad: 8, costo: 30000, precio: 35294, moneda: 'COP', precio_manual: false }],
    })
    expect(filas.at(-1)).toMatchObject({ nombre: 'Traslado aeropuerto al hotel', extra: true, cantidad: 8, precioTotal: 282352, aMano: false })
  })

  it('sin costo confirmado no hay filas del grupo', () => {
    expect(filasDeCosto({ confirmada: null, precioLinea: 0 })).toEqual([])
  })
})

describe('el precio de la línea con precios a mano', () => {
  it('lo escrito a mano, más las demás filas con el margen de la opción', () => {
    expect(precioDeLineaConManuales({ confirmada: CONFIRMADA, preciosAMano: aMano({ adulto: 700000 }), margenPct: 15, convencion: 'sobre_venta' }))
      .toBe(700000 * 6 + Math.round((151400 + 22000) / 0.85))
  })

  it('sin precios a mano no decide nada: manda la cascada', () => {
    expect(precioDeLineaConManuales({ confirmada: CONFIRMADA, preciosAMano: {}, margenPct: 15 })).toBeNull()
  })

  it('el documento reparte igual que la tarjeta', () => {
    const precios = aMano({ adulto: 700000 })
    const linea = precioDeLineaConManuales({ confirmada: CONFIRMADA, preciosAMano: precios, margenPct: 15, convencion: 'sobre_venta' })!
    const doc = precioPorPasajero(CONFIRMADA, linea, precios)
    const tarjeta = filasDeCosto({ confirmada: CONFIRMADA, precioLinea: linea, preciosAMano: precios })
    expect(doc.map(p => p.precioUnitario)).toEqual(tarjeta.map(f => f.precioUnitario))
    expect(precioPorHabitacion([{ numero: 1, ocupacion: { adultos: 2, ninos: 0, infantes: 0 }, totalCOP: 100 }], 200, aMano({ 'hab:1': 150 }))[0])
      .toMatchObject({ precio: 150, aMano: true })
  })
})

// ── Alojamiento ──
function lectura(tipo: string, ocupacion: string, a: number, n: number, i: number, total: number): LecturaCasilla {
  return {
    moneda: 'COP', total, aPagarAgencia: null, porTipo: [],
    ocupacion: { adultos: a, ninos: n, infantes: i, total: null },
    ocupacionDelItem: false, identidad: { tipo_habitacion: tipo }, notasCliente: [], alertas: [],
    campos: [{ label: 'Ocupación', valor: ocupacion }], nombre: '', descripcion: '', leidaEn: AHORA,
  } as LecturaCasilla
}
const ROOMS: Habitacion[] = [
  { id: 'h1', lectura: lectura('Cabaña Triple', '2 Adultos - 1 Niño (5 años)', 2, 1, 0, 1419400) },
  { id: 'h2', lectura: lectura('Cabaña Triple', '2 Adultos - 1 Infante (1 año)', 2, 0, 1, 1290000) },
  { id: 'h3', lectura: lectura('Cabaña Triple', '2 Adultos', 2, 0, 0, 1268000) },
]

describe('el alojamiento', () => {
  it('lo que una persona corrigió de una habitación manda sobre lo leído', () => {
    const corregida: Habitacion = {
      ...ROOMS[2],
      correccion: { ocupacion: { adultos: 1, ninos: 0, infantes: 0 }, total: 900000, por: 'Alejandra', porId: 'p1', en: AHORA },
    }
    const r = repartirHabitaciones([ROOMS[0], ROOMS[1], corregida], GRUPO)
    const h3 = r.habitaciones.find(h => h.id === 'h3')!
    expect(h3.ocupacion).toEqual({ adultos: 1, ninos: 0, infantes: 0 })
    expect(h3.total).toBe(900000)
    expect(resumenDeAlojamiento(r).titulo).toBe('3 habitaciones · falta 1 adulto')
  })

  it('«3 habitaciones · cubre a los 8 viajeros» y los cupos completos', () => {
    const r = resumenDeAlojamiento(repartirHabitaciones(ROOMS, GRUPO))
    expect(r.titulo).toBe('3 habitaciones · cubre a los 8 viajeros')
    expect(r.cupos).toEqual([
      { texto: '6/6 adultos', falta: false },
      { texto: '1/1 niño', falta: false },
      { texto: '1/1 infante', falta: false },
    ])
    expect(r.falta).toBeNull()
  })

  it('sin la habitación del infante: «falta 1 infante» y la caja que la pide', () => {
    const r = resumenDeAlojamiento(repartirHabitaciones([ROOMS[0], ROOMS[2]], GRUPO))
    expect(r.titulo).toBe('2 habitaciones · faltan 2 adultos y 1 infante')
    expect(r.falta).toEqual({ verbo: 'Faltan', quien: '2 adultos y 1 infante' })
    expect(r.cupos.find(c => c.texto.includes('infante'))).toEqual({ texto: '0/1 infante', falta: true })
  })

  it('la de solo adultos dice que también saca el precio del niño y del infante', () => {
    const reparto = repartirHabitaciones(ROOMS, GRUPO)
    const ref = reparto.habitaciones.find(h => h.id === 'h3')!
    expect(notaDeReferencia(ref.sirveParaRestar, costoPorTipoDeHabitaciones(reparto)))
      .toBe('ONE también la usa para sacar el precio del niño (151.400) y del infante (22.000).')
    expect(notaDeReferencia(false, costoPorTipoDeHabitaciones(reparto))).toBeNull()
  })

  it('la ocupación con las edades que dice la captura', () => {
    expect(ocupacionConEdades({ adultos: 2, ninos: 1, infantes: 0 }, '2 Adultos - 1 Niño (5 años)')).toBe('2 adultos + 1 niño (5 años)')
    expect(ocupacionConEdades({ adultos: 2, ninos: 0, infantes: 1 }, '2 Adultos - 1 Infante (1 año)')).toBe('2 adultos + 1 infante (1 año)')
  })

  it('un «niño de 0 años» se cuenta como infante y lo dice la nota, no la ocupación', () => {
    const texto = '2 adultos, 1 niño (0 años)'
    expect(ocupacionConEdades({ adultos: 2, ninos: 0, infantes: 1 }, texto)).toBe('2 adultos + 1 infante')
    expect(notaDeEdad(texto)).toBe('El pantallazo dice niño de 0 años: ONE lo cuenta como infante.')
    expect(notaDeEdad('2 adultos, 1 niño (5 años)')).toBeNull()
  })
})

describe('las fechas de la ficha', () => {
  it('mismo mes, meses distintos y años distintos', () => {
    expect(fechasDeEstadia('23 nov 2026', '25 nov 2026')).toBe('23 al 25 nov 2026')
    expect(fechasDeEstadia('2026-11-28', '2026-12-02')).toBe('28 nov al 2 dic 2026')
    expect(fechasDeEstadia('2026-12-30', '2027-01-02')).toBe('30 dic 2026 al 2 ene 2027')
    expect(fechasDeEstadia(null, null)).toBeNull()
  })
})
