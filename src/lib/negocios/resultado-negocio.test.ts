import { describe, it, expect } from 'vitest'
import { calcularResultado } from './resultado-negocio'

describe('calcularResultado', () => {
  it('mide la utilidad contra el precio aprobado, no contra lo cobrado', () => {
    // El caso que motivó el cambio: anticipo del 30% y costo ya incurrido. Medido
    // sobre lo cobrado daba margen negativo; el negocio deja 40%.
    const r = calcularResultado({ precioAprobado: 100_000, totalCobrado: 30_000, costosEjecutados: 60_000 })
    expect(r.base).toBe('precio_aprobado')
    expect(r.utilidad).toBe(40_000)
    expect(r.margenPct).toBe(40)
  })

  it('deja la caja aparte de la utilidad', () => {
    const r = calcularResultado({ precioAprobado: 100_000, totalCobrado: 30_000, costosEjecutados: 60_000 })
    expect(r.cobrado).toBe(30_000)
    expect(r.porCobrar).toBe(70_000)
  })

  it('cae a lo cobrado cuando no hay precio aprobado', () => {
    const r = calcularResultado({ precioAprobado: null, totalCobrado: 50_000, costosEjecutados: 20_000 })
    expect(r.base).toBe('cobrado')
    expect(r.valorBase).toBe(50_000)
    expect(r.margenPct).toBe(60)
  })

  it('no inventa un "por cobrar" cuando no hay precio aprobado', () => {
    // Mutación que mata: `porCobrar: Math.max(0, precio - cobrado)` sin el gate de
    // precio > 0 devolvería 0 aquí y se leería como "ya está todo cobrado".
    const r = calcularResultado({ precioAprobado: 0, totalCobrado: 50_000, costosEjecutados: 20_000 })
    expect(r.porCobrar).toBe(0)
    expect(r.base).toBe('cobrado')
  })

  it('declara el margen desconocido, no cero, cuando no hay contra qué medir', () => {
    const r = calcularResultado({ precioAprobado: null, totalCobrado: 0, costosEjecutados: 80_000 })
    expect(r.base).toBe('ninguna')
    expect(r.margenPct).toBeNull()
    expect(r.utilidad).toBe(-80_000)
  })

  it('un costo por encima del precio da utilidad y margen negativos', () => {
    const r = calcularResultado({ precioAprobado: 100_000, totalCobrado: 100_000, costosEjecutados: 130_000 })
    expect(r.utilidad).toBe(-30_000)
    expect(r.margenPct).toBe(-30)
  })

  it('un sobrecobro no deja "por cobrar" negativo', () => {
    const r = calcularResultado({ precioAprobado: 100_000, totalCobrado: 120_000, costosEjecutados: 10_000 })
    expect(r.porCobrar).toBe(0)
  })
})
