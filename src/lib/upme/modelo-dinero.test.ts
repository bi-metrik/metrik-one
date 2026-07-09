import { describe, it, expect } from 'vitest'
import {
  componerPrecioAprobado,
  repartirPagoTarifaHonorario,
  tipoCobroHonorario,
  saldoEsperadoPorModalidad,
  type ModeloDinero,
} from './modelo-dinero'

describe('componerPrecioAprobado — precio = honorario + tarifa', () => {
  it('suma honorario + tarifa', () => {
    expect(componerPrecioAprobado(3_000_000, 1_200_000)).toBe(4_200_000)
  })
  it('sin tarifa (0) → precio = honorario (comportamiento previo)', () => {
    expect(componerPrecioAprobado(3_000_000, 0)).toBe(3_000_000)
  })
  it('tarifa negativa o NaN se trata como 0 (no resta)', () => {
    expect(componerPrecioAprobado(3_000_000, -50 as number)).toBe(3_000_000)
    expect(componerPrecioAprobado(3_000_000, Number.NaN)).toBe(3_000_000)
  })
  it('redondea a peso', () => {
    expect(componerPrecioAprobado(1_000_000.4, 500_000.4)).toBe(1_500_001)
  })
})

describe('repartirPagoTarifaHonorario — la tarifa se cubre primero', () => {
  it('pago > tarifa → pasante = tarifa, honorario = resto', () => {
    const r = repartirPagoTarifaHonorario(4_200_000, 1_200_000)
    expect(r.monto_pasante).toBe(1_200_000)
    expect(r.monto_honorario).toBe(3_000_000)
  })
  it('pago = tarifa → todo pasante, honorario 0', () => {
    const r = repartirPagoTarifaHonorario(1_200_000, 1_200_000)
    expect(r.monto_pasante).toBe(1_200_000)
    expect(r.monto_honorario).toBe(0)
  })
  it('SIN BARRERAS: pago < tarifa → pasante toma todo el pago, honorario 0 (no rechaza)', () => {
    const r = repartirPagoTarifaHonorario(800_000, 1_200_000)
    expect(r.monto_pasante).toBe(800_000)
    expect(r.monto_honorario).toBe(0)
  })
  it('50/50: 1er pago = tarifa completa + 50% honorario', () => {
    // honorario 3M, tarifa 1.2M. 1er pago (anticipo) = 1.2M + 1.5M = 2.7M
    const r = repartirPagoTarifaHonorario(2_700_000, 1_200_000)
    expect(r.monto_pasante).toBe(1_200_000)   // tarifa completa primero
    expect(r.monto_honorario).toBe(1_500_000) // 50% del honorario de 3M
  })
  it('sin tarifa (0) → todo honorario', () => {
    const r = repartirPagoTarifaHonorario(3_000_000, 0)
    expect(r.monto_pasante).toBe(0)
    expect(r.monto_honorario).toBe(3_000_000)
  })
})

describe('tipoCobroHonorario — según modalidad', () => {
  it('plan 1 (50/50) → anticipo', () => {
    expect(tipoCobroHonorario(1)).toBe('anticipo')
  })
  it('plan 2 (único) → pago', () => {
    expect(tipoCobroHonorario(2)).toBe('pago')
  })
  it('sin modalidad → pago', () => {
    expect(tipoCobroHonorario(null)).toBe('pago')
  })
})

describe('saldoEsperadoPorModalidad — 50/50 espera el 2º 50% del honorario', () => {
  const base = (over: Partial<ModeloDinero>): ModeloDinero => ({
    tarifa_upme: 1_200_000,
    aprobado_plan: 1,
    aprobado_honorario: 3_000_000,
    ...over,
  })
  it('50/50 → saldo esperado = 50% del honorario (NO descuadre)', () => {
    expect(saldoEsperadoPorModalidad(base({}))).toBe(1_500_000)
  })
  it('único (plan 2) → saldo esperado 0', () => {
    expect(saldoEsperadoPorModalidad(base({ aprobado_plan: 2 }))).toBe(0)
  })
  it('sin modelo → 0', () => {
    expect(saldoEsperadoPorModalidad(null)).toBe(0)
  })
  it('50/50 sin honorario conocido → 0 (no oculta faltante real)', () => {
    expect(saldoEsperadoPorModalidad(base({ aprobado_honorario: null }))).toBe(0)
  })
})

describe('escenario integrado 50/50: precio, reparto y descuadre', () => {
  it('el descuadre = 0 cuando solo falta el 2º 50% esperado', () => {
    const honorario = 3_000_000
    const tarifa = 1_200_000
    const modelo: ModeloDinero = { tarifa_upme: tarifa, aprobado_plan: 1, aprobado_honorario: honorario }
    const precio = componerPrecioAprobado(honorario, tarifa) // 4.2M
    // 1er pago 50/50: tarifa completa + 50% honorario = 2.7M
    const primerPago = tarifa + honorario * 0.5
    const cobrado = primerPago
    const diferencia = precio - cobrado           // 1.5M pendiente
    const esperado = saldoEsperadoPorModalidad(modelo) // 1.5M esperado
    const descuadre = diferencia - esperado       // 0 → NO es descuadre
    expect(descuadre).toBe(0)
  })
})
