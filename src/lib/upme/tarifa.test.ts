import { describe, it, expect } from 'vitest'
import {
  calcularTarifaUpme,
  calcularTarifaUpmeDetalle,
  calcularTarifaUpmePorAnio,
  UMBRAL_BENEFICIO_UVT,
  TARIFA_FIJO_UVT,
  TARIFA_TOPE_UVT,
} from './tarifa'
import { uvtDelAnio, UVT_POR_ANIO } from './uvt'

// UVT de referencia para los casos (2026). Los cálculos se hacen a mano contra
// la fórmula Res. UPME 135/2025 Art. 13 para blindar el helper.
const UVT = UVT_POR_ANIO[2026] // 52.374

describe('calcularTarifaUpme (Res. UPME 135/2025 Art. 13)', () => {
  it('caso EN EL UMBRAL exacto (3.305 UVT) → beneficio 0 → tarifa = 13,4·UVT', () => {
    const valorSinIva = UMBRAL_BENEFICIO_UVT * UVT // exactamente 3.305 UVT en COP
    const d = calcularTarifaUpmeDetalle(valorSinIva, UVT)
    expect(d.beneficioUvt).toBeCloseTo(0, 6)
    expect(d.beneficioCop).toBeCloseTo(0, 3)
    // pago mínimo = 13,4·UVT + 0 = 13,4·UVT
    expect(d.tarifaCop).toBe(Math.round(TARIFA_FIJO_UVT * UVT))
  })

  it('caso POR DEBAJO del umbral → beneficio negativo, NO se descarta ni se frena', () => {
    const valorSinIva = 1_000 * UVT // 1.000 UVT, muy por debajo de 3.305
    const d = calcularTarifaUpmeDetalle(valorSinIva, UVT)
    // Beneficio = (1000 − 3305) × 0,405 = −933,525 UVT → negativo
    expect(d.beneficioUvt).toBeCloseTo((1_000 - 3_305) * 0.405, 6)
    expect(d.beneficioUvt).toBeLessThan(0)
    // La tarifa es lo que dé la fórmula: 13,4·UVT + (beneficioCop × 0,5%), por
    // debajo de 13,4·UVT — pero es un número válido, no null, no error.
    const esperado = Math.round(TARIFA_FIJO_UVT * UVT + d.beneficioCop * 0.005)
    expect(d.tarifaCop).toBe(esperado)
    expect(d.tarifaCop).toBeLessThan(Math.round(TARIFA_FIJO_UVT * UVT))
    expect(Number.isFinite(d.tarifaCop)).toBe(true)
  })

  it('caso TOPE (275·UVT) → un valor enorme queda topado a 275 UVT', () => {
    // Para que el pago mínimo alcance 275·UVT: 13,4·UVT + (benef × 0,5%) = 275·UVT
    // → benef = (275 − 13,4)·UVT / 0,005 = 52.320·UVT
    // → valorUvt = 52.320/0,405 + 3.305 ≈ 132.481 UVT. Usamos bastante más para topar.
    const valorSinIva = 500_000 * UVT // 500.000 UVT
    const d = calcularTarifaUpmeDetalle(valorSinIva, UVT)
    expect(d.pagoMinimoCop).toBeGreaterThan(d.topeCop)
    expect(d.tarifaCop).toBe(Math.round(TARIFA_TOPE_UVT * UVT))
  })

  it('caso INTERMEDIO típico (~4.500 UVT) → entre el fijo y el tope', () => {
    const valorUvt = 4_500
    const valorSinIva = valorUvt * UVT
    const d = calcularTarifaUpmeDetalle(valorSinIva, UVT)
    const beneficioUvt = (valorUvt - 3_305) * 0.405
    const beneficioCop = beneficioUvt * UVT
    const pagoMinimo = Math.round(13.4 * UVT + beneficioCop * 0.005)
    expect(d.tarifaCop).toBe(pagoMinimo)
    expect(d.tarifaCop).toBeGreaterThan(Math.round(TARIFA_FIJO_UVT * UVT))
    expect(d.tarifaCop).toBeLessThan(Math.round(TARIFA_TOPE_UVT * UVT))
  })

  it('atajo calcularTarifaUpme devuelve el mismo entero que el detalle', () => {
    const valorSinIva = 4_000 * UVT
    expect(calcularTarifaUpme(valorSinIva, UVT)).toBe(
      calcularTarifaUpmeDetalle(valorSinIva, UVT).tarifaCop,
    )
  })

  it('redondea a peso (entero)', () => {
    const d = calcularTarifaUpmeDetalle(3_507.37 * UVT, UVT)
    expect(Number.isInteger(d.tarifaCop)).toBe(true)
  })
})

describe('uvtDelAnio', () => {
  it('devuelve el UVT del año pedido', () => {
    expect(uvtDelAnio(2025)).toBe(49_799)
    expect(uvtDelAnio(2026)).toBe(52_374)
  })

  it('cae al año más reciente cuando el año no está en la tabla', () => {
    expect(uvtDelAnio(1999)).toBe(52_374)
    expect(uvtDelAnio(undefined)).toBe(52_374)
  })
})

describe('calcularTarifaUpmePorAnio', () => {
  it('resuelve el UVT del año internamente', () => {
    const valorSinIva = 4_000 * 52_374
    expect(calcularTarifaUpmePorAnio(valorSinIva, 2026)).toBe(
      calcularTarifaUpme(valorSinIva, 52_374),
    )
  })
})
