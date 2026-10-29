import { describe, expect, it } from 'vitest'

import { calcularCascada } from './totales'
import { POLITICA_REGLAS_POR_DEFECTO } from './reglas-margen'
import {
  comisionDelPantallazo,
  confirmacionFueraDeLaPublica,
  factorPublicoDelPantallazo,
  lecturaTraeComision,
  leerTipoTarifa,
  margenDeOpcionPublica,
  propuestaDelPantallazo,
  propuestaDelTarifario,
} from './tarifa-publica'

/**
 * QA Trappvel del 2026-10-29, grupo G6 (Pública), con las cifras del viaje 04: el Ecohabs se leyó
 * con precio al público $8.960.000, neto $7.884.800 y comisión de la agencia 12 % ($1.075.200).
 *
 *  · M6: ONE lo dejaba Neta (costo neto, margen 12 % = la comisión) y, al pasarlo a Pública con su
 *    12 %, la comisión se restaba DOS veces del costo (el neto ya la tenía descontada).
 *  · M7: en Pública, «Precio c/u» dejaba bajar del público sin aviso.
 *  · M8: los puntos extra NO caen sobre una Pública (se verifica: no era bug).
 */

const EN = '2026-10-29T17:39:14.256Z'
const DOS = { precioCliente: 8_960_000, costoAgencia: 7_884_800, margenPct: 12 }

const base = { cantidad: 1, numeroDeRubros: 0, precio_venta: 0, precio_manual: false }
function ecohabs(tipoTarifa: unknown, margen: number | null = 12) {
  return {
    ...base,
    id: 'eco',
    grupo: 'hotel: Hotel en Parque Tayrona',
    nombre: 'ECOHAHS TAYRONA',
    subtotal: 7_884_800,
    margen_porcentaje: margen,
    tarifa_pax: { tipoTarifa, confirmada: { margenProveedor: { ...DOS, moneda: 'COP' } } },
  }
}
const actividad = { ...base, id: 'act', grupo: 'actividad', nombre: 'Snorkel', subtotal: 600_000, margen_porcentaje: null }
const traslado = { ...base, id: 'tr', grupo: 'traslado', nombre: 'Traslado', subtotal: 400_000, margen_porcentaje: null }
const params = (puntosExtra = 0) => ({
  administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const,
  reglas: { politica: POLITICA_REGLAS_POR_DEFECTO, puntosExtra, descuentos: [] },
})
const publica = (extra: Record<string, unknown> = {}) => ({ tipo: 'publica', origen: 'persona', por: 'Asesora', en: EN, ...extra })

describe('M6 · la Pública que trae el pantallazo', () => {
  it('el factor del precio público es precio al cliente / neto; sin los dos precios, 1', () => {
    expect(factorPublicoDelPantallazo(DOS) * 7_884_800).toBeCloseTo(8_960_000, 4)
    expect(factorPublicoDelPantallazo(null)).toBe(1)
    expect(factorPublicoDelPantallazo({ precioCliente: 100, costoAgencia: 120, margenPct: -20 })).toBe(1)
  })

  it('la comisión leída es la del pantallazo, en % del precio público', () => {
    expect(comisionDelPantallazo(DOS)).toEqual({ tipo: 'pct', valor: 12 })
  })

  it('ONE propone Pública con la comisión cuando la captura dice la comisión', () => {
    const p = propuestaDelPantallazo(null, DOS, true, EN)
    expect(p).toMatchObject({ tipo: 'publica', origen: 'pantallazo', comisionPct: 12 })
    // Y se lee igual de vuelta (el origen nuevo no se pierde al leer el jsonb).
    expect(leerTipoTarifa(p)).toMatchObject({ origen: 'pantallazo', comisionPct: 12 })
  })

  it('no pisa a una persona ni al tarifario; retira su propia propuesta si la captura ya no la dice', () => {
    expect(propuestaDelPantallazo({ tipo: 'neta', origen: 'persona', por: 'A', en: EN }, DOS, true, EN)).toBeNull()
    expect(propuestaDelPantallazo({ tipo: 'publica', origen: 'tarifario', por: null, en: EN }, DOS, true, EN)).toBeNull()
    const propia = propuestaDelPantallazo(null, DOS, true, EN) as never
    expect(propuestaDelPantallazo(propia, null, false, EN)).toBe('quitar')
    expect(propuestaDelPantallazo(propia, DOS, true, EN)).toBeNull()
    // Un neto sin comisión escrita en la captura no basta para llamarla Pública.
    expect(propuestaDelPantallazo(null, DOS, false, EN)).toBeNull()
    // El tarifario tampoco pisa lo que propuso el pantallazo.
    expect(propuestaDelTarifario(propia, 'neta', EN)).toBeNull()
  })

  it('la captura trae comisión: derivada de ella, o con la casilla «Comisión de la agencia»', () => {
    expect(lecturaTraeComision({ costoAgenciaOrigen: 'derivado_comision', campos: [] })).toBe(true)
    expect(lecturaTraeComision({ costoAgenciaOrigen: 'neto_leido', campos: [{ label: 'Comisión de la agencia (%)', valor: '12' }] })).toBe(true)
    expect(lecturaTraeComision({ costoAgenciaOrigen: 'neto_leido', campos: [{ label: 'Precio neto (lo que paga la agencia)', valor: '7884800' }] })).toBe(false)
    expect(lecturaTraeComision(null)).toBe(false)
  })

  it('Neta o Pública con la comisión leída: mismo precio y mismo margen global (la comisión no se resta dos veces)', () => {
    const neta = calcularCascada([ecohabs(null), actividad, traslado], params())
    const pub = calcularCascada([ecohabs(publica({ comisionPct: 12 })), actividad, traslado], params())
    expect(pub.precioVenta).toBe(neta.precioVenta)
    expect(pub.lineas[0].precioLinea).toBe(8_960_000)
    expect(pub.lineas[0].comisionPesos).toBe(0)
    expect(pub.margenRealPct).toBeCloseTo(neta.margenRealPct!, 6)
    expect(pub.publicas.comision).toBe(0)
  })

  it('una Pública de siempre (costo = precio público) da las mismas cifras que antes', () => {
    const item = { ...base, id: 'h', grupo: 'hotel', nombre: 'Hotel', subtotal: 2_000_000, margen_porcentaje: null, tarifa_pax: { tipoTarifa: publica({ comisionPct: 20 }) } }
    const c = calcularCascada([item], params())
    expect(c.lineas[0].precioLinea).toBe(2_000_000)
    expect(c.lineas[0].comisionPesos).toBe(400_000)
  })

  it('la tarjeta dice 12 % con la comisión leída (no 22,6 %)', () => {
    const precioPublico = 7_884_800 * factorPublicoDelPantallazo(DOS)
    const m = margenDeOpcionPublica({
      comision: { tipo: 'pct', valor: 12 },
      precioPublico,
      costo: 7_884_800 + (precioPublico - 7_884_800),
      precio: 8_960_000,
    })
    expect(m).toBeCloseTo(12, 6)
  })
})

describe('M7 · «Precio c/u» por fuera de la tarifa pública', () => {
  it('pregunta con la cifra cuando baja del público', () => {
    expect(confirmacionFueraDeLaPublica({ precio: 2_200_000, publico: 2_240_000, que: 'el precio por adulto' })).toBe(
      '¿Estás seguro? Esto está por fuera de la tarifa pública: el precio por adulto queda en $2.200.000 y la tarifa pública es $2.240.000 ($40.000 menos).',
    )
  })

  it('pregunta también cuando sube del público', () => {
    expect(confirmacionFueraDeLaPublica({ precio: 2_300_000, publico: 2_240_000, que: 'el precio de la opción' })).toContain('($60.000 más)')
  })

  it('no pregunta con el precio público (al peso)', () => {
    expect(confirmacionFueraDeLaPublica({ precio: 2_240_000, publico: 2_240_000.4, que: 'x' })).toBeNull()
    expect(confirmacionFueraDeLaPublica({ precio: 2_240_001, publico: 2_240_000, que: 'x' })).toBeNull()
  })
})

describe('M8 · los puntos extra no caen sobre la Pública (verificación: no era bug)', () => {
  it('con 5 puntos, el precio de la Pública sigue siendo el público y los pesos van a lo demás', () => {
    const items = [ecohabs(publica({ comisionPct: 12 })), actividad, traslado]
    const sin = calcularCascada(items, params(0))
    const con = calcularCascada(items, params(5))
    const eco = (c: typeof con) => c.lineas.find(l => l.id === 'eco')!
    expect(eco(con).precioConAdicionales).toBe(eco(sin).precioConAdicionales)
    expect(eco(con).reglas?.puntos).toBe(0)
    expect(con.precioVenta).toBeGreaterThan(sin.precioVenta)
    const puntos = con.lineas.reduce((s, l) => s + (l.reglas?.puntos ?? 0), 0)
    expect(puntos).toBe(con.precioVenta - sin.precioVenta)
  })
})
