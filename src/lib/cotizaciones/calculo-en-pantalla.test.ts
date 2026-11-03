import { describe, expect, it } from 'vitest'

import { calcularCascada, type ItemParaCascada, type ParametrosCascada } from './totales'
import { calculoEnPantalla } from './calculo-en-pantalla'
import { margenDelEncabezado } from './por-pasos-vista'
import { margenDeOpcionPublica } from './tarifa-publica'
import { POLITICA_REGLAS_POR_DEFECTO } from './reglas-margen'

/**
 * La prueba en pantalla del 2026-10-29 (COT-2026-0023, ya borrada), con datos inventados: un hotel
 * Público de $2.000.000 y una actividad Neta de $1.000.000 al 0 %, con la casilla de la cotización en
 * 15 %. Brief `brief-max-2026-10-29-comision-publica-pantalla.md`.
 */

const EN = '2026-10-29T15:00:00.000Z'
const params = (reglas = true): ParametrosCascada => ({
  administrativosPct: 0,
  margenPct: 15,
  descuentoComercialPct: 0,
  convencionMargen: 'sobre_venta',
  reglas: reglas ? { politica: POLITICA_REGLAS_POR_DEFECTO, puntosExtra: 0, descuentos: [] } : null,
})
const linea = (x: Partial<ItemParaCascada> & { id: string }): ItemParaCascada => ({
  cantidad: 1,
  numeroDeRubros: 0,
  margen_porcentaje: null,
  precio_venta: 0,
  precio_manual: false,
  ...x,
})
const hotelPublico = (comision: Record<string, number> | null) => linea({
  id: 'h-pub',
  grupo: 'hotel',
  nombre: 'Hotel Ficticio Arena',
  subtotal: 2_000_000,
  tarifa_pax: { tipoTarifa: { tipo: 'publica', origen: 'persona', por: 'Asesora', en: EN, ...(comision ?? {}) } },
})
const actividad = linea({ id: 'act', grupo: 'actividad', nombre: 'Paseo ficticio', subtotal: 1_000_000 })

describe('falla 2 · «Ver el cálculo» dice lo mismo que el encabezado', () => {
  it('comisión en 20 %: costo $2.600.000 y margen real 13,3 %, igual que el encabezado', () => {
    const c = calcularCascada([hotelPublico({ comisionPct: 20 }), actividad], params())
    const v = calculoEnPantalla(c)
    expect(v.comisionPublicas).toBe(400_000)
    expect(v.costoDeVenta).toBe(2_600_000)
    expect(v.margenDelViajePct).toBeCloseTo(13.333, 2)
    expect(v.margenDelViajePct).toBe(margenDelEncabezado(c, params()))
  })

  it('comisión en $300.000: 10 %, también igual al encabezado', () => {
    const c = calcularCascada([hotelPublico({ comisionMonto: 300_000 }), actividad], params())
    const v = calculoEnPantalla(c)
    expect(v.costoDeVenta).toBe(2_700_000)
    expect(v.margenDelViajePct).toBeCloseTo(10, 6)
    expect(v.margenDelViajePct).toBe(margenDelEncabezado(c, params()))
  })

  it('la casilla de 15 % no la toma ninguna línea (una Pública y una actividad)', () => {
    const c = calcularCascada([hotelPublico({ comisionPct: 20 }), actividad], params())
    expect(calculoEnPantalla(c).lineasQueTomanElMargen).toBe(0)
    // Un hotel Neta sin margen propio sí la toma; con margen propio, no.
    const neta = linea({ id: 'h-neta', grupo: 'hotel', subtotal: 850_000 })
    const propio = linea({ id: 'h-propio', grupo: 'hotel', subtotal: 850_000, margen_porcentaje: 20 })
    expect(calculoEnPantalla(calcularCascada([neta, propio, actividad], params())).lineasQueTomanElMargen).toBe(1)
    // Sin reglas no se cuenta: la casilla es la de siempre.
    expect(calculoEnPantalla(calcularCascada([neta], params(false))).lineasQueTomanElMargen).toBeNull()
  })

  it('una Pública sin comisión deja el margen sin medir (no se inventa un 0)', () => {
    const c = calcularCascada([hotelPublico(null), actividad], params())
    const v = calculoEnPantalla(c)
    expect(v.margenDelViajePct).toBeNull()
    expect(v.publicasSinComision).toBe(1)
    expect(v.costoDeVenta).toBe(3_000_000)
  })

  it('el dinero no cambia: precio $3.000.000 y la cascada cruda igual que antes', () => {
    const c = calcularCascada([hotelPublico({ comisionPct: 20 }), actividad], params())
    expect(c.precioVenta).toBe(3_000_000)
    expect(c.costoDeVenta).toBe(3_000_000)
    expect(c.lineas.map(l => l.precioConAdicionales)).toEqual([2_000_000, 1_000_000])
  })

  it('sin Públicas ni reglas es la cascada de siempre', () => {
    const c = calcularCascada([linea({ id: 'x', grupo: 'hotel', subtotal: 850_000 })], params(false))
    const v = calculoEnPantalla(c)
    expect(v.costoDeVenta).toBe(c.costoDeVenta)
    expect(v.margenDelViajePct).toBe(c.margenRealPct)
    expect(v.comisionPublicas).toBe(0)
  })
})

describe('falla 1 · el margen de la opción Pública es comisión / precio público', () => {
  const base = { precioPublico: 2_000_000, costo: 2_000_000, precio: 2_000_000 }
  it('$300.000 da 15 % y 20 % da 20 %', () => {
    expect(margenDeOpcionPublica({ ...base, comision: { tipo: 'monto', valor: 300_000 } })).toBeCloseTo(15, 6)
    expect(margenDeOpcionPublica({ ...base, comision: { tipo: 'pct', valor: 20 } })).toBeCloseTo(20, 6)
  })
  it('sin comisión no hay margen que decir; en pesos nunca más que el precio público', () => {
    expect(margenDeOpcionPublica({ ...base, comision: null })).toBeNull()
    expect(margenDeOpcionPublica({ ...base, comision: { tipo: 'monto', valor: 9_000_000 } })).toBeCloseTo(100, 6)
    expect(margenDeOpcionPublica({ ...base, precio: 0, comision: { tipo: 'pct', valor: 20 } })).toBeNull()
  })
})
