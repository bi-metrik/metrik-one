import { describe, it, expect } from 'vitest'
import {
  calcularTarifaUpme,
  calcularTarifaUpmeDetalle,
  calcularTarifaUpmePorAnio,
  pagoEscalonTramoBajoUvt,
  UMBRAL_BENEFICIO_UVT,
  TARIFA_FIJO_UVT,
  TARIFA_TOPE_UVT,
} from './tarifa'
import { uvtDelAnio, UVT_POR_ANIO } from './uvt'

// UVT de referencia para los casos (2026). Los cálculos se hacen a mano contra
// la fórmula Res. UPME 135/2025 Art. 13 para blindar el helper.
const UVT = UVT_POR_ANIO[2026] // 52.374

describe('calcularTarifaUpme — tramo BAJO < 3.305 UVT (Art. 13 numeral 1, tabla)', () => {
  // La tabla escalonada: cada valor de inversión cae en su rango y paga el fijo
  // del escalón, sin beneficio ni tope.
  const casos: Array<{ nombre: string; valorUvt: number; pagoUvt: number }> = [
    { nombre: '[0, 275)', valorUvt: 100, pagoUvt: 1.2 },
    { nombre: '[0, 275) borde 0', valorUvt: 0, pagoUvt: 1.2 },
    { nombre: '[275, 826)', valorUvt: 500, pagoUvt: 3.4 },
    { nombre: '[275, 826) borde inferior 275', valorUvt: 275, pagoUvt: 3.4 },
    { nombre: '[826, 1.652)', valorUvt: 1_200, pagoUvt: 6.7 },
    { nombre: '[826, 1.652) borde inferior 826', valorUvt: 826, pagoUvt: 6.7 },
    { nombre: '[1.652, 3.305)', valorUvt: 2_400, pagoUvt: 13.4 },
    { nombre: '[1.652, 3.305) borde inferior 1.652', valorUvt: 1_652, pagoUvt: 13.4 },
    { nombre: '[1.652, 3.305) justo bajo el umbral', valorUvt: 3_304, pagoUvt: 13.4 },
  ]

  for (const c of casos) {
    it(`rango ${c.nombre} → ${c.pagoUvt} UVT`, () => {
      const d = calcularTarifaUpmeDetalle(c.valorUvt * UVT, UVT)
      expect(d.tramo).toBe('tabla')
      expect(d.pagoEscalonUvt).toBe(c.pagoUvt)
      expect(d.beneficioUvt).toBe(0)
      expect(d.beneficioCop).toBe(0)
      expect(d.tarifaCop).toBe(Math.round(c.pagoUvt * UVT))
    })
  }

  it('helper pagoEscalonTramoBajoUvt devuelve el escalón correcto por rango', () => {
    expect(pagoEscalonTramoBajoUvt(0)).toBe(1.2)
    expect(pagoEscalonTramoBajoUvt(274.99)).toBe(1.2)
    expect(pagoEscalonTramoBajoUvt(275)).toBe(3.4)
    expect(pagoEscalonTramoBajoUvt(825.99)).toBe(3.4)
    expect(pagoEscalonTramoBajoUvt(826)).toBe(6.7)
    expect(pagoEscalonTramoBajoUvt(1_651.99)).toBe(6.7)
    expect(pagoEscalonTramoBajoUvt(1_652)).toBe(13.4)
    expect(pagoEscalonTramoBajoUvt(3_304.99)).toBe(13.4)
  })

  it('ejemplo real ~$150M con IVA (2.407 UVT) → escalón 13,4 UVT (antes subestimaba)', () => {
    const sinIva = 150_000_000 / 1.19 // ≈ 126,05M → ≈ 2.406,7 UVT
    const d = calcularTarifaUpmeDetalle(sinIva, UVT)
    expect(d.valorSinIvaUvt).toBeGreaterThan(1_652)
    expect(d.valorSinIvaUvt).toBeLessThan(UMBRAL_BENEFICIO_UVT)
    expect(d.tramo).toBe('tabla')
    expect(d.tarifaCop).toBe(Math.round(13.4 * UVT)) // $701.812
  })

  it('ejemplo real ~$80M con IVA (1.284 UVT) → escalón 6,7 UVT (antes sobreestimaba)', () => {
    const sinIva = 80_000_000 / 1.19 // ≈ 67,23M → ≈ 1.283,6 UVT
    const d = calcularTarifaUpmeDetalle(sinIva, UVT)
    expect(d.valorSinIvaUvt).toBeGreaterThan(826)
    expect(d.valorSinIvaUvt).toBeLessThan(1_652)
    expect(d.tramo).toBe('tabla')
    expect(d.tarifaCop).toBe(Math.round(6.7 * UVT)) // $350.906
  })
})

describe('calcularTarifaUpme — tramo ALTO ≥ 3.305 UVT (Art. 13 numeral 2, fórmula)', () => {
  it('caso EN EL UMBRAL exacto (3.305 UVT) → beneficio 0 → tarifa = 13,4·UVT', () => {
    const valorSinIva = UMBRAL_BENEFICIO_UVT * UVT // exactamente 3.305 UVT en COP
    const d = calcularTarifaUpmeDetalle(valorSinIva, UVT)
    expect(d.tramo).toBe('formula')
    expect(d.beneficioUvt).toBeCloseTo(0, 6)
    expect(d.beneficioCop).toBeCloseTo(0, 3)
    // pago mínimo = 13,4·UVT + 0 = 13,4·UVT
    expect(d.tarifaCop).toBe(Math.round(TARIFA_FIJO_UVT * UVT))
  })

  it('el umbral 3.305 UVT es continuo entre tramos (tabla y fórmula dan 13,4·UVT)', () => {
    const justoBajo = calcularTarifaUpmeDetalle((UMBRAL_BENEFICIO_UVT - 0.5) * UVT, UVT)
    const enUmbral = calcularTarifaUpmeDetalle(UMBRAL_BENEFICIO_UVT * UVT, UVT)
    expect(justoBajo.tramo).toBe('tabla')
    expect(enUmbral.tramo).toBe('formula')
    expect(justoBajo.tarifaCop).toBe(Math.round(TARIFA_FIJO_UVT * UVT))
    expect(enUmbral.tarifaCop).toBe(Math.round(TARIFA_FIJO_UVT * UVT))
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
