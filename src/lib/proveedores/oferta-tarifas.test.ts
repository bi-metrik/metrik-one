/**
 * Las tarifas extraídas ofrecidas en la línea y su cálculo (Mauricio, 2026-10-19). Tarifarios
 * ficticios: ningún proveedor, precio ni fila real.
 */
import { describe, expect, it } from 'vitest'

import { ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'
import { resolverTarifa, type Composicion } from '@/lib/cotizaciones/tarifa-pasajero'
import { escalonesIncoherentes } from './extraccion'
import {
  ajustesPorDefecto,
  calcularEleccion,
  calendarioDelViaje,
  lecturaDeTarifa,
  ofrecerTarifas,
  revisarAjustes,
  type AjustesDeCosto,
  type Eleccion,
} from './oferta-tarifas'
import { tarifasParaCotizar } from './tarifas-extraidas'

const NETA: AjustesDeCosto = { canal: 'neta', comisionPct: null, ivaIncluido: false, ivaPct: 19 }
const DOS: Composicion = { adultos: 2, ninos: 0, infantes: 0 }
const FAMILIA: Composicion = { adultos: 2, ninos: 1, infantes: 1 }

const fila = (x: Record<string, unknown>) => ({ moneda: 'COP', establecimiento: null, archivo: 'Tarifas Ficticias 2027.pdf', fuente: { pagina: 2, texto: 'cita' }, ...x })

const HOTEL = {
  temporadas: [
    { id: 'T1', nombre: 'Baja', rangos: [{ desde: '2027-01-10', hasta: '2027-03-14' }] },
    { id: 'T2', nombre: 'Alta', rangos: [{ desde: '2027-03-15', hasta: '2027-04-05' }] },
    { id: 'T3', nombre: 'Festivos', rangos: [{ desde: null, hasta: null, texto: 'puentes' }] },
  ],
  tarifas: [
    fila({ categoria: 'Doble Estándar', temporada_id: 'T1', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 300000, plan: 'Desayuno' }),
    fila({ categoria: 'Doble Estándar', temporada_id: 'T2', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 400000, plan: 'Desayuno' }),
    fila({ categoria: 'Doble Estándar', temporada_id: 'T1', base_precio: 'por_persona_noche', tipo_pasajero: 'adulto', precio: 160000 }),
    fila({ categoria: 'Doble Estándar', temporada_id: 'T1', base_precio: 'por_persona_noche', tipo_pasajero: 'nino', precio: 80000 }),
    fila({ categoria: 'Doble Estándar', temporada_id: 'T2', base_precio: 'por_persona_noche', tipo_pasajero: 'adulto', precio: 200000 }),
    fila({ categoria: 'Suite', temporada_id: 'T3', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 900000 }),
    fila({ categoria: 'Suite USD', temporada_id: 'T1', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 120, moneda: 'USD' }),
    fila({ categoria: 'Sin base', temporada_id: 'T1', precio: 1 }),
  ],
}

const revisada = (tarifario: Record<string, unknown>) => ({ estado: 'revisada' as const, vigenciaDesde: '2027-01-01', vigenciaHasta: '2027-12-31', tarifario, monedas: null })

function oferta(tarifario: Record<string, unknown>, composicion: Composicion, entrada: string | null, salida: string | null, establecimiento: string | null = null) {
  const u = tarifasParaCotizar(revisada(tarifario), establecimiento)
  if (!u.ok) throw new Error(u.motivo)
  return ofrecerTarifas({ usables: u.tarifas, tarifario, composicion, entrada, salida })
}

function calcular(tarifario: Record<string, unknown>, composicion: Composicion, entrada: string | null, salida: string | null, eleccion: Eleccion, ajustes = NETA) {
  const o = oferta(tarifario, composicion, entrada, salida)
  return calcularEleccion({ opciones: o.opciones, eleccion, composicion, calendario: o.calendario, ajustes })
}

describe('ofrecer: el filtro dice por qué, no esconde', () => {
  it('temporada que no cae en el viaje y niño que no viaja quedan marcados; la temporada sin fechas se avisa', () => {
    const o = oferta(HOTEL, DOS, '2027-02-01', '2027-02-04')
    const por = (i: number) => o.opciones.find((x) => x.indice === i)?.fueraPor
    expect(o.calendario.noches).toBe(3)
    expect(por(0)).toEqual([])
    expect(por(1)).toEqual(['temporada'])
    expect(por(3)).toEqual(['pasajero'])
    expect(por(5)).toEqual([])
    expect(o.opciones.find((x) => x.indice === 5)?.temporada).toMatchObject({ nombre: 'Festivos', dias: null })
    expect(o.avisos.join(' ')).toMatch(/Temporada sin fechas en el tarifario: elige tú/)
    // La fila sin base se ofrece igual (se ve), pero no se puede calcular.
    expect(o.opciones.find((x) => x.indice === 7)?.baseTexto).toBe('sin base de precio')
  })

  it('cada opción dice precio, moneda, base en llano y de qué archivo y página sale', () => {
    const o = oferta(HOTEL, DOS, '2027-02-01', '2027-02-04').opciones[0]
    expect(o).toMatchObject({ precio: 300000, moneda: 'COP', baseTexto: 'por habitación, por noche', archivo: 'Tarifas Ficticias 2027.pdf', pagina: 2, categoria: 'Doble Estándar', plan: 'Desayuno' })
  })

  it('sin fechas en la línea no filtra por temporada y lo dice', () => {
    const o = oferta(HOTEL, DOS, null, null)
    expect(o.opciones.every((x) => !x.fueraPor.includes('temporada'))).toBe(true)
    expect(o.avisos[0]).toMatch(/no tiene fechas/)
  })

  it('un viaje que cruza dos temporadas lo avisa con las noches de cada una', () => {
    const cal = calendarioDelViaje(HOTEL, '2027-03-12', '2027-03-17')
    expect(cal.noches).toBe(5)
    expect(cal.temporadas.T1.dias).toBe(3)
    expect(cal.temporadas.T2.dias).toBe(2)
    expect(cal.cruza).toEqual(['T1', 'T2'])
    expect(oferta(HOTEL, DOS, '2027-03-12', '2027-03-17').avisos.join(' ')).toMatch(/cruza 2 temporadas: Baja \(3 noches\) y Alta \(2 noches\)/)
  })

  it('tarifario de cadena: solo las filas del establecimiento de la ficha', () => {
    const cadena = { tarifas: [fila({ establecimiento: 'Hotel Ficticio Centro', base_precio: 'por_grupo', precio: 1 }), fila({ establecimiento: 'Hotel Ficticio Playa', base_precio: 'por_grupo', precio: 2 })] }
    expect(tarifasParaCotizar(revisada(cadena), null)).toEqual({ ok: false, motivo: 'elegir_establecimiento' })
    expect(oferta(cadena, DOS, null, null, 'hotel ficticio playa').opciones.map((x) => x.precio)).toEqual([2])
  })
})

describe('calcular: la base de precio manda', () => {
  it('por habitación: precio × noches × habitaciones (la doble propone 1 habitación para 2)', () => {
    const r = calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 0 }] })
    expect(r.ok && r.calculo).toMatchObject({ total: 900000, aPagarAgencia: null, modo: 'repartido', porTipo: [{ tipo: 'adulto', cantidad: 2, subtotal: 900000 }] })
    expect(r.ok && r.calculo.filas[0].texto).toBe('1 habitación × 3 noches × $300.000 = $900.000')
  })

  it('por habitación con 4 adultos en doble propone 2 habitaciones; se puede cambiar', () => {
    const cuatro = { adultos: 4, ninos: 0, infantes: 0 }
    const r = calcular(HOTEL, cuatro, '2027-02-01', '2027-02-04', { filas: [{ indice: 0 }] })
    expect(r.ok && r.calculo.total).toBe(1800000)
    const r3 = calcular(HOTEL, cuatro, '2027-02-01', '2027-02-04', { filas: [{ indice: 0, cantidad: 3 }] })
    expect(r3.ok && r3.calculo.total).toBe(2700000)
  })

  it('por persona: precio × noches × pasajeros de su tipo; el infante que no paga en cero', () => {
    const r = calcular(HOTEL, FAMILIA, '2027-02-01', '2027-02-04', { filas: [{ indice: 2 }, { indice: 3 }], noPagan: ['infante'] })
    expect(r.ok && r.calculo).toMatchObject({
      total: 1200000,
      modo: 'por_pasajero',
      porTipo: [{ tipo: 'adulto', cantidad: 2, subtotal: 960000 }, { tipo: 'nino', cantidad: 1, subtotal: 240000 }, { tipo: 'infante', cantidad: 1, subtotal: 0 }],
    })
  })

  it('por persona sin tarifa para un tipo que viaja: lo pide, no adivina', () => {
    const r = calcular(HOTEL, FAMILIA, '2027-02-01', '2027-02-04', { filas: [{ indice: 2 }, { indice: 3 }] })
    expect(r).toEqual({ ok: false, error: 'Falta la tarifa de 1 infante: elige una o marca que no paga.' })
  })

  it('viaje que cruza temporadas: una tarifa por temporada, cada una con sus noches', () => {
    const r = calcular(HOTEL, DOS, '2027-03-12', '2027-03-17', { filas: [{ indice: 0 }, { indice: 1 }] })
    expect(r.ok && r.calculo.total).toBe(300000 * 3 + 400000 * 2)
    const p = calcular(HOTEL, DOS, '2027-03-12', '2027-03-17', { filas: [{ indice: 2 }, { indice: 4 }] })
    expect(p.ok && p.calculo.total).toBe(2 * 160000 * 3 + 2 * 200000 * 2)
    // Sin cruzar temporadas, dos tarifas para los mismos adultos sobran.
    expect(calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 2 }, { indice: 4 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/elegiste tarifa para 4/) })
  })

  it('por grupo y por trayecto: una vez; por vehículo: por vehículo', () => {
    const t = { tarifas: [fila({ categoria: 'Traslado privado', base_precio: 'por_grupo', precio: 250000 }), fila({ categoria: 'Van', base_precio: 'por_vehiculo_trayecto', precio: 180000 }), fila({ categoria: 'Ruta', base_precio: 'por_trayecto_total', precio: 90000 })] }
    expect(calcular(t, FAMILIA, null, null, { filas: [{ indice: 0, cantidad: 7 }] })).toMatchObject({ ok: true, calculo: { total: 250000 } })
    expect(calcular(t, FAMILIA, null, null, { filas: [{ indice: 1, cantidad: 2 }] })).toMatchObject({ ok: true, calculo: { total: 360000 } })
    const r = calcular(t, FAMILIA, null, null, { filas: [{ indice: 2 }] })
    // Repartido entre adultos y niños por partes iguales; el infante en cero.
    expect(r.ok && r.calculo.porTipo).toEqual([{ tipo: 'adulto', cantidad: 2, subtotal: 60000 }, { tipo: 'nino', cantidad: 1, subtotal: 30000 }, { tipo: 'infante', cantidad: 1, subtotal: 0 }])
  })

  it('por noche sin fechas en la línea: pide las noches; con noches escritas calcula', () => {
    expect(calcular(HOTEL, DOS, null, null, { filas: [{ indice: 0 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/cuántas noches/) })
    expect(calcular(HOTEL, DOS, null, null, { filas: [{ indice: 0, noches: 2 }] })).toMatchObject({ ok: true, calculo: { total: 600000 } })
  })

  it('no mezcla monedas, no calcula sin base y no acepta filas que no ofreció', () => {
    expect(calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 0 }, { indice: 6 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/una sola moneda/) })
    expect(calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 7 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/base de precio/) })
    expect(calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 99 }] })).toMatchObject({ ok: false })
    expect(calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [] })).toMatchObject({ ok: false })
  })

  it('tarifa en USD: el cálculo queda en USD (la tasa se pide al confirmar)', () => {
    const r = calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 6 }] })
    expect(r.ok && r.calculo).toMatchObject({ moneda: 'USD', total: 360 })
  })
})

describe('L60: el escalón de pax del motor', () => {
  const TOUR = {
    tarifas: [
      fila({ categoria: 'Tour Ficticio', base_precio: 'por_persona', tipo_pasajero: 'adulto', pax_min: 1, pax_max: 2, precio: 300000 }),
      fila({ categoria: 'Tour Ficticio', base_precio: 'por_persona', tipo_pasajero: 'adulto', pax_min: 3, pax_max: 4, precio: 250000 }),
      fila({ categoria: 'Tour Ficticio', base_precio: 'por_persona', tipo_pasajero: 'adulto', pax_min: 5, pax_max: null, precio: 220000 }),
      fila({ categoria: 'Lancha Ficticia', base_precio: 'por_grupo', pax_min: 1, pax_max: 4, precio: 800000 }),
      fila({ categoria: 'Lancha Ficticia', base_precio: 'por_grupo', pax_min: 5, pax_max: 8, precio: 1200000 }),
    ],
  }

  it('la tabla es coherente para el motor (el total del grupo no cae al subir de escalón)', () => {
    expect(escalonesIncoherentes(TOUR.tarifas)).toEqual([])
  })

  it('con 3 adultos solo sirve el escalón 3–4; el total es 3 × 250.000', () => {
    const tres = { adultos: 3, ninos: 0, infantes: 0 }
    const o = oferta(TOUR, tres, null, null)
    expect(o.opciones.filter((x) => x.fueraPor.length === 0).map((x) => x.indice)).toEqual([1, 3])
    expect(o.opciones.find((x) => x.indice === 0)?.fueraPor).toEqual(['pax'])
    expect(calcular(TOUR, tres, null, null, { filas: [{ indice: 1 }] })).toMatchObject({ ok: true, calculo: { total: 750000 } })
    expect(calcular(TOUR, tres, null, null, { filas: [{ indice: 3 }] })).toMatchObject({ ok: true, calculo: { total: 800000 } })
  })

  it('4 adultos y un infante: el escalón que cubre contando o sin contar al infante se ofrece (no hay certeza)', () => {
    const o = oferta(TOUR, { adultos: 4, ninos: 0, infantes: 1 }, null, null)
    expect(o.opciones.filter((x) => x.fueraPor.length === 0).map((x) => x.indice)).toEqual([1, 2, 3, 4])
  })
})

describe('canal e IVA', () => {
  it('comisionable: el total es el precio y la agencia paga el neto', () => {
    const r = calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 0 }] }, { canal: 'comisionable', comisionPct: 10, ivaIncluido: false, ivaPct: 19 })
    expect(r.ok && r.calculo).toMatchObject({ total: 900000, aPagarAgencia: 810000 })
    expect(calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 0 }] }, { canal: 'comisionable', comisionPct: null, ivaIncluido: false, ivaPct: 19 })).toMatchObject({ ok: false, error: expect.stringMatching(/% de comisión/) })
  })

  it('IVA incluido: el costo se guarda sin IVA', () => {
    const r = calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 0 }] }, { canal: 'neta', comisionPct: null, ivaIncluido: true, ivaPct: 19 })
    expect(r.ok && r.calculo).toMatchObject({ bruto: 900000, total: 756302.52 })
    expect(r.ok && r.calculo.porTipo.reduce((a, f) => a + f.subtotal, 0)).toBeCloseTo(756302.52, 2)
  })

  it('precio al público se usa como costo con aviso', () => {
    const r = calcular(HOTEL, DOS, '2027-02-01', '2027-02-04', { filas: [{ indice: 0 }] }, { canal: 'publica', comisionPct: null, ivaIncluido: false, ivaPct: 19 })
    expect(r.ok && r.calculo.avisos.join(' ')).toMatch(/precio al público/)
  })

  it('por defecto: la fila manda sobre la ficha y la ficha sobre el tarifario', () => {
    const t = { canal: 'comisionable', comision_pct: 12, impuestos: { iva_incluido: true, iva_pct: 19 } }
    expect(ajustesPorDefecto({ ficha: { tarifaCanal: null, ivaIncluido: null }, tarifario: t })).toEqual({ canal: 'comisionable', comisionPct: 12, ivaIncluido: true, ivaPct: 19 })
    expect(ajustesPorDefecto({ ficha: { tarifaCanal: 'neta', ivaIncluido: false }, tarifario: t })).toEqual({ canal: 'neta', comisionPct: null, ivaIncluido: false, ivaPct: 19 })
    expect(ajustesPorDefecto({ fila: { precioTipo: 'publico', impuestosIncluidos: null }, ficha: { tarifaCanal: 'neta', ivaIncluido: null }, tarifario: {} }).canal).toBe('publica')
  })

  it('los ajustes del navegador se revisan', () => {
    expect(revisarAjustes({ canal: 'otra' }, NETA)).toMatchObject({ ok: false })
    expect(revisarAjustes({ canal: 'comisionable', comisionPct: 150 }, NETA)).toMatchObject({ ok: false })
    expect(revisarAjustes({ canal: 'comisionable', comisionPct: 15 }, NETA)).toEqual({ ok: true, ajustes: { canal: 'comisionable', comisionPct: 15, ivaIncluido: false, ivaPct: 19 } })
  })
})

describe('la elección como lectura de la casilla 1', () => {
  it('la confirmación de siempre la resuelve por pasajero, sin pedir otro pantallazo', () => {
    const ranura = ranuraDeGrupo('hotel')!
    const o = oferta(HOTEL, FAMILIA, '2027-02-01', '2027-02-04')
    const r = calcularEleccion({ opciones: o.opciones, eleccion: { filas: [{ indice: 0, cantidad: 1 }] }, composicion: FAMILIA, calendario: o.calendario, ajustes: { canal: 'comisionable', comisionPct: 10, ivaIncluido: false, ivaPct: 19 } })
    if (!r.ok) throw new Error(r.error)
    const l = lecturaDeTarifa({ ranura, calculo: r.calculo, elegidas: [o.opciones[0]], proveedor: { nombre: 'Hotel Ficticio', ciudad: 'Cartagena' }, composicion: FAMILIA, entrada: '2027-02-01', salida: '2027-02-04', leidaEn: '2026-10-19T12:00:00.000Z' })
    expect(l).toMatchObject({ origen: 'tarifario', total: 900000, aPagarAgencia: 810000, costoAgenciaOrigen: 'derivado_comision', nombre: 'Hotel Ficticio' })
    expect(l.campos).toEqual(expect.arrayContaining([{ label: 'Hotel', valor: 'Hotel Ficticio' }, { label: 'Ciudad', valor: 'Cartagena' }, { label: 'Check-in', valor: '2027-02-01' }, { label: 'Archivo', valor: 'Tarifas Ficticias 2027.pdf' }]))
    const e = resolverTarifa(FAMILIA, { grupo_completo: l }, ranura.slug)
    expect(e).toMatchObject({ estado: 'resuelta', origen: 'desglose', costoTotal: 810000 })
    if (e.estado === 'resuelta') expect(e.costos.map((x) => [x.tipo, x.total])).toEqual([['adulto', 540000], ['nino', 270000], ['infante', 0]])
  })
})
