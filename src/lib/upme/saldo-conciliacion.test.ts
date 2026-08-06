import { describe, it, expect } from 'vitest'
import {
  saldoConciliacion,
  descuadreConciliacion,
  type ModeloDinero,
} from './modelo-dinero'
import { saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'

// El saldo que muestra la pestaña Saldos tiene que usar la MISMA asimetría que el
// resto del producto: faltante contra el HONORARIO, exceso contra el VALOR A RECAUDAR.
// Medirlo simétrico contra honorario + tarifa convierte en deudor a todo cliente que le
// pagó la tarifa DIRECTO a la UPME, que es un flujo normal, no cartera.

const HONORARIO = 637_500
const TARIFA = 701_812
const modelo: ModeloDinero = { tarifa_upme: TARIFA, aprobado_plan: null, aprobado_honorario: null }

describe('saldoConciliacion — signo del saldo del cliente', () => {
  it('CASO REAL: pagó todo el honorario y la tarifa la pagó directo a la UPME → NO es faltante', () => {
    // El cliente le transfirió a SOENA solo el honorario; la tarifa nunca pasó por
    // SOENA. Exigírsela es inventarle una deuda: 25 de los 33 faltantes de producción
    // eran exactamente esto (2026-08-06).
    expect(saldoConciliacion(HONORARIO, modelo, HONORARIO)).toBe(0)
    expect(saldoCuadrado(saldoConciliacion(HONORARIO, modelo, HONORARIO))).toBe(true)
  })

  it('pagó honorario + tarifa en un solo recaudo → tampoco es descuadre', () => {
    expect(saldoConciliacion(HONORARIO, modelo, HONORARIO + TARIFA)).toBe(0)
  })

  it('cualquier punto entre honorario y valor a recaudar queda cuadrado', () => {
    // La franja entre las dos varas es zona muerta a propósito: ahí no se sabe (ni
    // importa) cuánto de la tarifa entró por SOENA.
    for (const extra of [1, 1_000, 350_906, TARIFA - 1]) {
      expect(saldoConciliacion(HONORARIO, modelo, HONORARIO + extra)).toBe(0)
    }
  })

  it('debe honorario de verdad → faltante positivo, del tamaño del honorario que falta', () => {
    expect(saldoConciliacion(HONORARIO, modelo, 0)).toBe(HONORARIO)
    expect(saldoConciliacion(HONORARIO, modelo, 137_500)).toBe(500_000)
  })

  it('pagó por encima del valor a recaudar → sobrante negativo', () => {
    expect(saldoConciliacion(HONORARIO, modelo, HONORARIO + TARIFA + 200_000)).toBe(-200_000)
  })

  it('sin tarifa confirmada, faltante y exceso se miden contra el honorario', () => {
    expect(saldoConciliacion(HONORARIO, null, 0)).toBe(HONORARIO)
    expect(saldoConciliacion(HONORARIO, null, HONORARIO + 5_000)).toBe(-5_000)
  })

  it('honorario 0 sin pagos → cuadrado (no hay nada que cobrar)', () => {
    expect(saldoConciliacion(0, modelo, 0)).toBe(0)
  })

  it('es exactamente faltante − exceso de descuadreConciliacion (una sola fórmula)', () => {
    for (const recaudado of [0, 1_000, HONORARIO, HONORARIO + TARIFA, HONORARIO + TARIFA + 99_999]) {
      const d = descuadreConciliacion(HONORARIO, modelo, recaudado)
      expect(saldoConciliacion(HONORARIO, modelo, recaudado)).toBe(d.faltante - d.exceso)
    }
  })

  it('faltante y exceso nunca son positivos a la vez, así que el signo no es ambiguo', () => {
    for (const recaudado of [0, 100, HONORARIO - 1, HONORARIO, HONORARIO + 1, HONORARIO + TARIFA + 1]) {
      const d = descuadreConciliacion(HONORARIO, modelo, recaudado)
      expect(d.faltante > 0 && d.exceso > 0).toBe(false)
    }
  })
})
