/**
 * Regla 80/15 y plan sugerido (Vera C2, F2-1, F2-3). Casos sintéticos.
 */
import { describe, expect, it } from 'vitest'
import {
  configPlanPagos,
  huellaPlan,
  leerCuotas,
  lineasDeValidacion,
  pesos,
  planSugerido,
  validarPlan,
  type CuotaPlan,
} from './plan-pagos'

const HOY = '2026-10-13'
const SALIDA = '2026-12-04'

describe('planSugerido (C2: 30 % hoy, completa el 80 % a T-15, 20 % el día del viaje)', () => {
  it('el caso de Noor: $9.165.000 con salida el 4 dic', () => {
    expect(planSugerido({ total: 9_165_000, fechaSalida: SALIDA, hoy: HOY })).toEqual([
      { numero: 0, monto: 2_750_000, fecha: HOY, concepto: 'Anticipo' },
      { numero: 1, monto: 4_582_000, fecha: '2026-11-19', concepto: null },
      { numero: 2, monto: 1_833_000, fecha: SALIDA, concepto: 'Saldo' },
    ])
  })

  it('a 15 días o menos: 80 % al confirmar y 20 % el día del viaje', () => {
    expect(planSugerido({ total: 5_000_000, fechaSalida: '2026-10-23', hoy: HOY })).toEqual([
      { numero: 0, monto: 4_000_000, fecha: HOY, concepto: 'Anticipo' },
      { numero: 1, monto: 1_000_000, fecha: '2026-10-23', concepto: 'Saldo' },
    ])
    // T-15 exactamente hoy cuenta como «ya pasó».
    expect(planSugerido({ total: 5_000_000, fechaSalida: '2026-10-28', hoy: HOY })?.[0].monto).toBe(4_000_000)
  })

  it('sin fecha o con la salida ya pasada no hay sugerido', () => {
    expect(planSugerido({ total: 5_000_000, fechaSalida: null, hoy: HOY })).toBeNull()
    expect(planSugerido({ total: 5_000_000, fechaSalida: '2026-10-01', hoy: HOY })).toBeNull()
    expect(planSugerido({ total: 0, fechaSalida: SALIDA, hoy: HOY })).toBeNull()
  })

  it('para cualquier total suma al peso y queda dentro de su propia regla (redondeo del 80 % hacia arriba)', () => {
    for (let total = 1_001_001; total < 40_000_000; total += 777_777) {
      for (const salida of [SALIDA, '2026-10-20', '2026-11-01']) {
        const c = planSugerido({ total, fechaSalida: salida, hoy: HOY })!
        const v = validarPlan(c, { total, fechaSalida: salida, hoy: HOY })
        expect(v.suma).toBe(total)
        expect(v.dentroDeRegla).toBe(true)
      }
    }
  })
})

describe('validarPlan (F2-3)', () => {
  const ctx = { total: 9_165_000, fechaSalida: SALIDA, hoy: HOY }
  const base = planSugerido(ctx)!

  it('un plan que no suma dice cuánto falta o sobra', () => {
    const v = validarPlan(base.map((c, i) => (i === 0 ? { ...c, monto: c.monto - 165_000 } : c)), ctx)
    expect(v).toMatchObject({ cuadra: false, diferencia: 165_000, dentroDeRegla: false })
    expect(lineasDeValidacion(v, ctx)[0].texto).toBe('Las cuotas suman $9.000.000 y el viaje vale $9.165.000. Faltan $165.000.')
  })

  it('al T-15 con el 70 % queda fuera de la regla, con el texto de Noor', () => {
    const c: CuotaPlan[] = [
      { numero: 0, monto: 6_415_500, fecha: HOY, concepto: null },
      { numero: 1, monto: 2_749_500, fecha: SALIDA, concepto: null },
    ]
    const v = validarPlan(c, ctx)
    expect(v.cuadra).toBe(true)
    expect(v.cumpleMinimo).toBe(false)
    expect(v.dentroDeRegla).toBe(false)
    expect(lineasDeValidacion(v, ctx)[1].texto).toBe('Al 19 nov el cliente llevaría el 70 %. La regla pide el 80 % 15 días antes del viaje.')
  })

  it('el 80 % justo al T-15 cumple; un peso menos no', () => {
    const justo: CuotaPlan[] = [
      { numero: 0, monto: 7_332_000, fecha: '2026-11-19', concepto: null },
      { numero: 1, monto: 1_833_000, fecha: SALIDA, concepto: null },
    ]
    expect(validarPlan(justo, ctx).dentroDeRegla).toBe(true)
    const menos = [{ ...justo[0], monto: 7_331_999 }, { ...justo[1], monto: 1_833_001 }]
    expect(validarPlan(menos, ctx).dentroDeRegla).toBe(false)
    // La cuota del 80 % un día después del T-15 tampoco cumple.
    expect(validarPlan([{ ...justo[0], fecha: '2026-11-20' }, justo[1]], ctx).dentroDeRegla).toBe(false)
  })

  it('una cuota después del viaje queda fuera, con su texto', () => {
    const c = base.map((x, i) => (i === base.length - 1 ? { ...x, fecha: '2026-12-05' } : x))
    const v = validarPlan(c, ctx)
    expect(v.despuesDelViaje).toBe(true)
    expect(v.dentroDeRegla).toBe(false)
    expect(lineasDeValidacion(v, ctx)[2].texto).toBe('La última cuota no puede ir después del viernes 4 dic, el día del viaje.')
  })

  it('sin fecha de salida ningún plan queda dentro de la regla', () => {
    expect(validarPlan(base, { ...ctx, fechaSalida: null }).dentroDeRegla).toBe(false)
  })
})

describe('huella del plan (la aprobación vale para estas cuotas, F2-3)', () => {
  const c = planSugerido({ total: 9_165_000, fechaSalida: SALIDA, hoy: HOY })!
  it('cambia si cambia un monto, una fecha o el total; no por el orden ni el número', () => {
    const h = huellaPlan(c, 9_165_000)
    expect(huellaPlan([...c].reverse().map((x, i) => ({ ...x, numero: i })), 9_165_000)).toBe(h)
    expect(huellaPlan(c.map((x, i) => (i === 1 ? { ...x, monto: x.monto + 1000 } : i === 2 ? { ...x, monto: x.monto - 1000 } : x)), 9_165_000)).not.toBe(h)
    expect(huellaPlan(c.map((x, i) => (i === 1 ? { ...x, fecha: '2026-11-18' } : x)), 9_165_000)).not.toBe(h)
    expect(huellaPlan(c, 9_166_000)).not.toBe(h)
  })
})

describe('config y entrada', () => {
  it('apagado por defecto; la regla por defecto es 80/15/30', () => {
    expect(configPlanPagos({})).toEqual({ activo: false, regla: { pct_minimo: 80, dias_antes: 15, anticipo_pct: 30 } })
    expect(configPlanPagos({ plan_pagos: { activo: 'true' } }).activo).toBe(false)
    expect(configPlanPagos({ plan_pagos: { activo: true, regla: { anticipo_pct: 40 } } }).regla.anticipo_pct).toBe(40)
  })

  it('leerCuotas rechaza lo que no tiene forma de cuota y ordena por fecha', () => {
    expect(leerCuotas([{ monto: 'x', fecha: HOY }])).toBeNull()
    expect(leerCuotas([{ monto: 10, fecha: '13/10/2026' }])).toBeNull()
    expect(leerCuotas([])).toBeNull()
    expect(leerCuotas([{ monto: 2, fecha: SALIDA }, { monto: 1, fecha: HOY }])?.map((c) => [c.numero, c.monto])).toEqual([[0, 1], [1, 2]])
  })

  it('pesos con el formato del documento', () => {
    expect(pesos(9_165_000)).toBe('$9.165.000')
    expect(pesos(-50_000)).toBe('-$50.000')
  })
})
