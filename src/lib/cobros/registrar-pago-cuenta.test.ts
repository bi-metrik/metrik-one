import { describe, it, expect } from 'vitest'
import {
  planearCobrosCompletos,
  planearAbonoParcial,
  anotar,
  type CobroDeCuenta,
} from './registrar-pago-cuenta'

// Caso real de la cuenta agrupada de AFI (mayo y junio de 2026), que es el que
// obligo a definir el modelo: tres cobros de negocios distintos en un solo
// documento, y pagos que no siempre calzan con el total.
const AFI: CobroDeCuenta[] = [
  { id: 'alma', monto: 400_000, fecha: null },
  { id: 'valida', monto: 100_000, fecha: null },
  { id: 'clarity', monto: 416_667, fecha: null },
]

describe('planearCobrosCompletos', () => {
  it('cierra la cuenta cuando el pago cubre TODOS los cobros', () => {
    const r = planearCobrosCompletos(AFI, ['alma', 'valida', 'clarity'], 916_667)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cierraLaCuenta).toBe(true)
    expect(r.saldoPendiente).toBe(0)
  })

  it('NO cierra la cuenta con un pago que cubre solo parte, y reporta el saldo', () => {
    // El caso de AFI mayo: $500k cubren ALMA + Valida completos y dejan Clarity
    // pendiente. La cuenta se queda en `enviada`, no pasa a `pagada`.
    const r = planearCobrosCompletos(AFI, ['alma', 'valida'], 500_000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cierraLaCuenta).toBe(false)
    expect(r.saldoPendiente).toBe(416_667)
  })

  it('cierra la cuenta cuando el ultimo cobro pendiente se paga', () => {
    const parcialmentePagada: CobroDeCuenta[] = [
      { id: 'alma', monto: 400_000, fecha: '2026-05-20' },
      { id: 'valida', monto: 100_000, fecha: '2026-05-20' },
      { id: 'clarity', monto: 416_667, fecha: null },
    ]
    const r = planearCobrosCompletos(parcialmentePagada, ['clarity'], 416_667)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cierraLaCuenta).toBe(true)
    expect(r.saldoPendiente).toBe(0)
  })

  it('rechaza cuando el monto declarado no coincide con los cobros elegidos', () => {
    // Es el corte que manda el caso al otro camino. Sin el, un abono de $600k
    // marcaria como pagados cobros que suman $500k.
    const r = planearCobrosCompletos(AFI, ['alma', 'valida'], 600_000)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('abono parcial')
  })

  it('rechaza un cobro que ya estaba pagado', () => {
    const yaPagado: CobroDeCuenta[] = [{ id: 'alma', monto: 400_000, fecha: '2026-05-20' }]
    const r = planearCobrosCompletos(yaPagado, ['alma'], 400_000)
    expect(r.ok).toBe(false)
  })

  it('rechaza un cobro que no pertenece a la cuenta', () => {
    const r = planearCobrosCompletos(AFI, ['ajeno'], 400_000)
    expect(r.ok).toBe(false)
  })

  it('rechaza una seleccion vacia', () => {
    expect(planearCobrosCompletos(AFI, [], 0).ok).toBe(false)
  })
})

describe('planearAbonoParcial', () => {
  it('reduce la cuota al saldo y deja el abono aparte, conservando el total', () => {
    // Caso de AFI junio: quedaban $416.667 de Clarity y entraron $100.000.
    const r = planearAbonoParcial(AFI, 'clarity', 100_000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.montoAbono).toBe(100_000)
    expect(r.montoReducido).toBe(316_667)
    // La invariante que sostiene todo el modelo: partir la cuota no mueve el total.
    expect(r.montoAbono + r.montoReducido).toBe(416_667)
  })

  it('rechaza un abono que cubre el cobro completo y manda al otro camino', () => {
    const r = planearAbonoParcial(AFI, 'valida', 100_000)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('cobro completo')
  })

  it('rechaza un abono mayor que el cobro', () => {
    expect(planearAbonoParcial(AFI, 'valida', 150_000).ok).toBe(false)
  })

  it('rechaza montos no positivos', () => {
    expect(planearAbonoParcial(AFI, 'clarity', 0).ok).toBe(false)
    expect(planearAbonoParcial(AFI, 'clarity', -1).ok).toBe(false)
    expect(planearAbonoParcial(AFI, 'clarity', Number.NaN).ok).toBe(false)
  })

  it('rechaza un cobro ya pagado', () => {
    const pagado: CobroDeCuenta[] = [{ id: 'x', monto: 400_000, fecha: '2026-05-20' }]
    expect(planearAbonoParcial(pagado, 'x', 100_000).ok).toBe(false)
  })
})

describe('anotar', () => {
  it('conserva el historial previo', () => {
    expect(anotar('linea 1', 'linea 2')).toBe('linea 1\nlinea 2')
  })

  it('no deja un salto de linea suelto cuando no habia notas', () => {
    expect(anotar(null, 'linea 1')).toBe('linea 1')
    expect(anotar('   ', 'linea 1')).toBe('linea 1')
  })
})
