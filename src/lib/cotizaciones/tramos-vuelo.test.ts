import { describe, expect, it } from 'vitest'

import { leerTramos, textoDeTramo, tramosDeCampos, type TramoVuelo } from './tramos-vuelo'
import { normalizarDeteccion } from '@/lib/ai/detectar-tipo-captura'
import { cargoDeItem, tramosDelItem, vuelosDeItems } from './detalle-viaje'
import { camposDeLectura } from './campos-de-lectura'
import type { LecturaCasilla } from './tarifa-pasajero'

/**
 * B3 del brief de captura del 2026-09-23: el vuelo guarda sus tramos, y la descripción y el
 * documento se arman desde ellos. B2: el cargo en destino es un campo de la opción.
 */

const campos = (d: Record<string, string>) => (slug: string) => d[slug]

describe('los tramos de un vuelo', () => {
  it('ida y regreso, cada uno con su número cuando se pueden repartir', () => {
    const { tramos, numerosSinTramo } = tramosDeCampos(campos({
      origen: 'Bogotá', destino: 'Cancún',
      fecha_salida: '2026-11-12', hora_salida: '13:10', hora_llegada: '17:00',
      fecha_regreso: '2026-11-18', hora_salida_regreso: '18:00',
      numero_vuelo: 'AV264 · AV265', escalas: '0',
      equipaje_bodega: 'true', equipaje_mano: 'true', equipaje_personal: 'true',
    }))
    expect(numerosSinTramo).toBeNull()
    expect(tramos).toHaveLength(2)
    expect(tramos[0]).toMatchObject({ sentido: 'ida', origen: 'Bogotá', destino: 'Cancún', numero: 'AV264', directo: true })
    expect(tramos[1]).toMatchObject({ sentido: 'regreso', origen: 'Cancún', destino: 'Bogotá', numero: 'AV265', directo: null })
    expect(tramos[0].equipaje).toMatchObject({ personal: true, mano: true, bodega: true })
  })

  it('un solo número con regreso no se pega a la ida: queda sin tramo', () => {
    const { tramos, numerosSinTramo } = tramosDeCampos(campos({ fecha_salida: '2026-11-12', fecha_regreso: '2026-11-18', numero_vuelo: 'AV264' }))
    expect(tramos.map(t => t.numero)).toEqual([null, null])
    expect(numerosSinTramo).toBe('AV264')
  })

  it('solo ida: no nace un regreso vacío', () => {
    const { tramos } = tramosDeCampos(campos({ fecha_salida: '2026-11-12', numero_vuelo: 'AV264' }))
    expect(tramos).toHaveLength(1)
    expect(tramos[0].numero).toBe('AV264')
  })

  it('en la descripción, la hora va pegada a la fecha de su tramo', () => {
    const t: TramoVuelo = {
      sentido: 'ida', origen: null, destino: null, fecha: '2026-11-12', salida: '13:10', llegada: '17:00',
      numero: 'AV264', escala: null, directo: null, equipaje: { personal: null, mano: null, bodega: null },
    }
    expect(textoDeTramo(t)).toBe('Ida AV264: 2026-11-12 13:10–17:00')
    expect(textoDeTramo({ ...t, sentido: 'regreso', fecha: '2026-11-18', numero: null, salida: null, llegada: null })).toBe('Regreso: 2026-11-18')
    expect(textoDeTramo({ ...t, fecha: null, salida: null, llegada: null, numero: null })).toBeNull()
  })

  it('lo guardado se valida entero: un tramo mal formado invalida el arreglo', () => {
    const bueno = { sentido: 'ida', origen: 'A', destino: 'B', fecha: null, salida: null, llegada: null, numero: 'X1', escala: null, directo: true, equipaje: {} }
    expect(leerTramos([bueno])).toHaveLength(1)
    expect(leerTramos([bueno, { ...bueno, sentido: 'vuelta' }])).toBeNull()
    expect(leerTramos([{ ...bueno, sentido: 'regreso' }])).toBeNull()
    expect(leerTramos([{ ...bueno, numero: 264 }])).toBeNull()
    expect(leerTramos([])).toBeNull()
    expect(leerTramos(null)).toBeNull()
  })
})

// ── El vuelo del documento sale de los tramos ────────────────────────────────

function casilla(lista: { label: string; valor: string }[]): LecturaCasilla {
  return {
    moneda: 'COP', total: 1, aPagarAgencia: null, porTipo: [],
    ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 }, ocupacionDelItem: false,
    identidad: {}, notasCliente: [], alertas: [], campos: lista, nombre: 'n', descripcion: '', leidaEn: 'x',
  }
}

const LECTURA_VUELO = casilla([
  { label: 'Aerolínea', valor: 'Avianca' },
  { label: 'Origen', valor: 'Bogotá' },
  { label: 'Destino', valor: 'Cancún' },
  { label: 'Salida', valor: '2026-11-12' },
  { label: 'Hora de salida (ida)', valor: '13:10' },
  { label: 'Nº de vuelo', valor: 'AV264' },
])

describe('B3 · el documento lee los tramos guardados, y sin ellos los deriva igual', () => {
  const item = { nombre: 'AVIANCA', grupo: 'vuelo', tarifa_pax: { casillas: { grupo_completo: LECTURA_VUELO } } }

  it('sin tramos guardados (migración pendiente o línea vieja), sale de la lectura', () => {
    const [v] = vuelosDeItems([item])
    expect(v).toMatchObject({ aerolinea: 'Avianca', origen: 'Bogotá', destino: 'Cancún', horaSalida: '13:10', numeros: { ida: 'AV264', regreso: null, sinAsignar: null } })
  })

  it('con tramos guardados, mandan ellos', () => {
    const [derivado] = tramosDelItem(item).tramos
    const guardado = [{ ...derivado, salida: '14:45', numero: 'AV999' }]
    const [v] = vuelosDeItems([{ ...item, tramos: guardado }])
    expect(v.horaSalida).toBe('14:45')
    expect(v.numeros?.ida).toBe('AV999')
  })

  it('guardar y volver a leer da el mismo vuelo: la columna es la lectura en su sitio', () => {
    const escribir = camposDeLectura({ nombre: item.nombre, grupo: item.grupo, tramos: null, cargo_destino_valor: null, cargo_destino_moneda: null }, item.tarifa_pax)
    const [sinColumna] = vuelosDeItems([item])
    const [conColumna] = vuelosDeItems([{ ...item, tramos: escribir.tramos }])
    expect(conColumna).toEqual(sinColumna)
  })
})

// ── B2 · el cargo en destino es de la opción ─────────────────────────────────

const LECTURA_HOTEL = casilla([
  { label: 'Hotel', valor: 'Sunscape' },
  { label: 'Ciudad', valor: 'Cancún' },
  { label: 'Impuestos en destino', valor: '50.080' },
  { label: 'Moneda de los impuestos en destino', valor: 'mxn' },
])

describe('B2 · el cargo en destino', () => {
  const hotel = { nombre: 'SUNSCAPE', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: LECTURA_HOTEL } } }

  it('sin el campo, sale de la lectura (con el monto en formato colombiano)', () => {
    expect(cargoDeItem(hotel)).toEqual({ valor: 50_080, moneda: 'MXN' })
  })

  it('el campo propio manda sobre la lectura', () => {
    expect(cargoDeItem({ ...hotel, cargo_destino_valor: '329.44', cargo_destino_moneda: 'usd' })).toEqual({ valor: 329.44, moneda: 'USD' })
  })

  it('al guardar la lectura se escriben el valor y la moneda; sin las columnas, no se nombran', () => {
    const fila = { nombre: 'SUNSCAPE', grupo: 'hotel', cargo_destino_valor: null, cargo_destino_moneda: null, tramos: null }
    expect(camposDeLectura(fila, hotel.tarifa_pax)).toEqual({ cargo_destino_valor: 50_080, cargo_destino_moneda: 'MXN', tramos: null })
    // Fila leída de una base sin la migración: el update no puede nombrar columnas que no hay.
    expect(camposDeLectura({ nombre: 'SUNSCAPE', grupo: 'hotel' }, hotel.tarifa_pax)).toEqual({})
  })

  it('si la lectura se queda sin cargo, el campo se vacía: los dos no pueden decir cosas distintas', () => {
    const sinCargo = { casillas: { grupo_completo: casilla([{ label: 'Hotel', valor: 'Sunscape' }]) } }
    expect(camposDeLectura({ nombre: 'X', grupo: 'hotel', cargo_destino_valor: 50_080, cargo_destino_moneda: 'MXN' }, sinCargo))
      .toEqual({ cargo_destino_valor: null, cargo_destino_moneda: null })
  })

  it('un monto desbocado no tumba el guardado de la lectura: queda vacío', () => {
    const loco = { casillas: { grupo_completo: casilla([{ label: 'Hotel', valor: 'X' }, { label: 'Impuestos en destino', valor: '98765432109876' }]) } }
    expect(camposDeLectura({ nombre: 'X', grupo: 'hotel', cargo_destino_valor: null, cargo_destino_moneda: null }, loco))
      .toEqual({ cargo_destino_valor: null, cargo_destino_moneda: null })
  })
})

// ── Paso 1 de Noor · de qué es el pantallazo ─────────────────────────────────

describe('la detección del tipo de captura', () => {
  it('un hotel trae su lugar; un vuelo, su origen y destino', () => {
    expect(normalizarDeteccion({ tipo: 'Hotel', lugar: ' Cancún ', origen: 'X' })).toEqual({ tipo: 'hotel', lugar: 'Cancún', origen: null, destino: null })
    expect(normalizarDeteccion({ tipo: 'vuelo', lugar: 'X', origen: 'Bogotá', destino: 'Cancún' })).toEqual({ tipo: 'vuelo', lugar: null, origen: 'Bogotá', destino: 'Cancún' })
  })

  it('lo que no es un tipo del catálogo es «no sé», no un tipo inventado', () => {
    expect(normalizarDeteccion({ tipo: 'crucero', lugar: 'Caribe' })).toEqual({ tipo: null, lugar: null, origen: null, destino: null })
    expect(normalizarDeteccion('hotel')).toEqual({ tipo: null, lugar: null, origen: null, destino: null })
    expect(normalizarDeteccion(null).tipo).toBeNull()
  })
})
