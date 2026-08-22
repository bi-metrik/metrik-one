import { describe, it, expect } from 'vitest'
import { normalizarCortePlanPago, filaPlanVacia } from './comercial-plan-pago'
import { planPagoLabel, type ComercialPlanPagoFila } from './comercial-types'

/**
 * Las cifras son las del workspace SOENA medidas el 2026-08-22, para que la prueba
 * falle el dia que alguien vuelva a tratar "sin plan declarado" como plan 2.
 */
function fila(p: Partial<ComercialPlanPagoFila> & { plan_pago: number | null }): ComercialPlanPagoFila {
  return {
    plan_pago: p.plan_pago,
    ventas: p.ventas ?? 0,
    valor_sin_iva: p.valor_sin_iva ?? 0,
    valor_con_iva: p.valor_con_iva ?? 0,
    primer_pago: p.primer_pago ?? 0,
    segundo_pago: p.segundo_pago === undefined ? null : p.segundo_pago,
    recaudado: p.recaudado ?? 0,
    casos_completos: p.casos_completos ?? 0,
    bonificables: p.bonificables ?? null,
    negocio_ids: p.negocio_ids ?? [],
  }
}

describe('normalizarCortePlanPago', () => {
  it('el grupo sin plan declarado va aparte y NUNCA sumado al plan 2', () => {
    // Agosto 2026 con un caso sin plan agregado a proposito: 5 de plan 1, 33 de plan 2.
    const { filas } = normalizarCortePlanPago([
      fila({ plan_pago: 2, ventas: 33 }),
      fila({ plan_pago: null, ventas: 4 }),
      fila({ plan_pago: 1, ventas: 5, segundo_pago: 0 }),
    ], 42)

    expect(filas.map((f) => f.plan_pago)).toEqual([1, 2, null])
    expect(filas.find((f) => f.plan_pago === 2)?.ventas).toBe(33)
    expect(filas.find((f) => f.plan_pago === null)?.ventas).toBe(4)
  })

  it('los dos planes se muestran aunque el mes no tenga ventas de uno', () => {
    // Julio: todas plan 2. "Ninguna venta fue 50/50" es un dato del mes, no un hueco.
    const { filas } = normalizarCortePlanPago([fila({ plan_pago: 2, ventas: 45 })], 45)

    expect(filas).toHaveLength(2)
    expect(filas[0]).toMatchObject({ plan_pago: 1, ventas: 0 })
  })

  it('no inventa el grupo sin declarar cuando todas las ventas tienen plan', () => {
    const { filas } = normalizarCortePlanPago([
      fila({ plan_pago: 1, ventas: 5, segundo_pago: 0 }),
      fila({ plan_pago: 2, ventas: 33 }),
    ], 38)

    expect(filas.some((f) => f.plan_pago === null)).toBe(false)
  })

  it('fuera del plan 1 el segundo pago es null, no cero', () => {
    // El plan 2 no tiene segundo tramo y sin plan no se sabe si lo hay: en ninguno de
    // los dos casos un $0 seria una medicion, y la pantalla dibuja raya.
    expect(filaPlanVacia(2).segundo_pago).toBeNull()
    expect(filaPlanVacia(null).segundo_pago).toBeNull()
    expect(filaPlanVacia(1).segundo_pago).toBe(0)
  })

  it('conserva un plan inesperado en vez de descartar sus ventas', () => {
    const { filas } = normalizarCortePlanPago([fila({ plan_pago: 3, ventas: 2 })], 2)

    expect(filas.map((f) => f.plan_pago)).toEqual([1, 2, 3])
    expect(filas.find((f) => f.plan_pago === 3)?.ventas).toBe(2)
  })

  it('el total del mes se conserva para poder cuadrar la suma', () => {
    const { total_ventas, filas } = normalizarCortePlanPago([
      fila({ plan_pago: 1, ventas: 5 }),
      fila({ plan_pago: 2, ventas: 33 }),
    ], 38)

    expect(total_ventas).toBe(38)
    expect(filas.reduce((s, f) => s + f.ventas, 0)).toBe(38)
  })
})

describe('planPagoLabel', () => {
  it('no traduce la ausencia de plan a un plan', () => {
    expect(planPagoLabel(null)).toBe('Plan sin declarar')
    expect(planPagoLabel(1)).toContain('50/50')
    expect(planPagoLabel(2)).toContain('100%')
  })
})
