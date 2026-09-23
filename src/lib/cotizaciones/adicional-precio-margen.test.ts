/**
 * P4 del ensayo del 2026-09-23 (Trappvel, caso Providencia): el precio del adicional sale
 * del margen global de la cotización, y el asesor lo puede cambiar después.
 *
 * Hasta ese día el adicional pedía costo Y precio, y un precio vacío se guardaba en 0: el
 * costo entraba al viaje y al cliente no se le cobraba nada.
 */
import { describe, expect, it } from 'vitest'

import {
  aAdicional,
  normalizarAdicional,
  precioDerivadoDeAdicional,
  preciosPorResincronizar,
  type FilaAdicional,
  type MargenDeCotizacion,
} from './adicionales'

const QUINCE: MargenDeCotizacion = { margenPct: 15, convencion: 'sobre_venta' }

describe('P4 · el precio del adicional sale del margen', () => {
  it('precio VACÍO: se calcula con el margen global, igual que la línea (costo / (1 − margen))', () => {
    const r = normalizarAdicional({ codigo: 'equipaje_bodega', costo: 80_000 }, QUINCE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.precio).toBe(94_118)
    expect(r.valor.precioManual).toBe(false)
  })

  it('precio vacío NUNCA se guarda en 0: sin margen legible, se pide escribirlo', () => {
    const r = normalizarAdicional({ codigo: 'equipaje_bodega', costo: 80_000 }, null)
    expect(r.ok).toBe(false)
  })

  it('con la convención de recargo el cálculo es el de la línea: costo × (1 + margen)', () => {
    expect(precioDerivadoDeAdicional(80_000, 'COP', { margenPct: 15, convencion: 'markup' })).toBe(92_000)
  })

  it('en otra moneda se guarda a dos decimales, en su moneda', () => {
    expect(precioDerivadoDeAdicional(30, 'USD', QUINCE)).toBe(35.29)
  })

  it('precio A MANO: manda lo escrito y queda marcado como escrito', () => {
    const r = normalizarAdicional({ codigo: 'equipaje_bodega', costo: 80_000, precio: 90_000 }, QUINCE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.precio).toBe(90_000)
    expect(r.valor.precioManual).toBe(true)
  })

  it('un precio a mano en 0 pide confirmación antes de guardarse', () => {
    const sin = normalizarAdicional({ codigo: 'seleccion_silla', costo: 20_000, precio: 0 }, QUINCE)
    expect(sin).toMatchObject({ ok: false, requiereConfirmacion: true })
    const con = normalizarAdicional({ codigo: 'seleccion_silla', costo: 20_000, precio: 0, confirmarPrecioBajo: true }, QUINCE)
    expect(con.ok).toBe(true)
  })

  it('un precio a mano por debajo del costo también', () => {
    expect(normalizarAdicional({ codigo: 'seleccion_silla', costo: 20_000, precio: 15_000 }, QUINCE))
      .toMatchObject({ ok: false, requiereConfirmacion: true })
  })
})

describe('P4 · si cambia el margen global, cambian los que no tienen precio a mano', () => {
  const derivado: FilaAdicional = { id: 'a', item_id: 'i', costo: 80_000, precio: 94_118, moneda: 'COP', precio_manual: false }
  const aMano: FilaAdicional = { id: 'b', item_id: 'i', costo: 80_000, precio: 90_000, moneda: 'COP', precio_manual: true }

  it('con el mismo margen no hay nada que reescribir', () => {
    expect(preciosPorResincronizar([derivado, aMano], QUINCE)).toEqual([])
  })

  it('sube el margen: el derivado se recalcula, el escrito a mano NO se toca', () => {
    expect(preciosPorResincronizar([derivado, aMano], { margenPct: 20, convencion: 'sobre_venta' }))
      .toEqual([{ id: 'a', precio: 100_000 }])
  })

  it('sin la columna en la base (migración pendiente), todo cuenta como escrito a mano', () => {
    const { precio_manual: _p, ...sinColumna } = derivado
    expect(preciosPorResincronizar([sinColumna], { margenPct: 20, convencion: 'sobre_venta' })).toEqual([])
    expect(aAdicional(sinColumna).precioManual).toBe(true)
  })
})
