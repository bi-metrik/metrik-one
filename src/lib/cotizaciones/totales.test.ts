import { describe, it, expect } from 'vitest'
import { calcularCascada, costoDeLinea, type ItemParaCascada } from './totales'

/** Ítem de costo directo, que es el caso normal desde el rediseño. */
function item(over: Partial<ItemParaCascada> = {}): ItemParaCascada {
  return { numeroDeRubros: 0, subtotal: 1_000_000, cantidad: 1, ...over }
}

describe('costo de la línea', () => {
  it('multiplica por la cantidad', () => {
    expect(costoDeLinea(item({ cantidad: 3 }))).toBe(3_000_000)
  })

  it('el descuento del ítem baja el COSTO, no el precio', () => {
    expect(costoDeLinea(item({ descuento_porcentaje: 10 }))).toBe(900_000)
  })

  it('con rubros manda la suma de rubros y se ignora el costo escrito a mano', () => {
    expect(costoDeLinea(item({ numeroDeRubros: 2, costoDeRubros: 400_000, subtotal: 999 }))).toBe(400_000)
  })

  it('el ítem de ajuste no aporta costo', () => {
    expect(costoDeLinea(item({ es_ajuste: true }))).toBe(0)
  })
})

describe('cascada de la cotización', () => {
  it('costo, administrativos, margen y descuento se aplican en ese orden', () => {
    const c = calcularCascada([item({ subtotal: 1_000_000, cantidad: 2 })], {
      administrativosPct: 10,
      margenPct: 20,
      descuentoComercialPct: 5,
      // Explícito: el default del producto es `sobre_venta`, y esta prueba mide la
      // aritmética del recargo sobre el costo.
      convencionMargen: 'markup',
    })
    expect(c.costoDirecto).toBe(2_000_000)
    expect(c.administrativos).toBe(200_000)
    expect(c.costoDeVenta).toBe(2_200_000)
    expect(c.ventaBruta).toBe(2_640_000) // 2.200.000 × 1,20
    expect(c.descuentoComercial).toBe(132_000)
    expect(c.precioVenta).toBe(2_508_000)
    expect(c.margenRealPct).toBeCloseTo(((2_508_000 - 2_200_000) / 2_508_000) * 100, 6)
  })

  it('el descuento del ítem NO se vuelve a cobrar sobre el precio', () => {
    // 1.000.000 con 10% de descuento de compra = 900.000 de costo. Con margen 0 el
    // precio es 900.000. Si el descuento se aplicara otra vez, saldría 810.000.
    const c = calcularCascada([item({ descuento_porcentaje: 10 })], { margenPct: 0 })
    expect(c.costoDirecto).toBe(900_000)
    expect(c.precioVenta).toBe(900_000)
  })

  it('una línea con margen propio no rompe la suma de administrativos', () => {
    const c = calcularCascada(
      [item({ id: 'a', subtotal: 1_000_000 }), item({ id: 'b', subtotal: 1_000_000, margen_porcentaje: 50 })],
      { administrativosPct: 10, margenPct: 20, convencionMargen: 'markup' },
    )
    expect(c.costoDirecto).toBe(2_000_000)
    expect(c.administrativos).toBe(200_000)
    expect(c.lineas[0].precioLinea).toBe(1_320_000) // 1.100.000 × 1,20
    expect(c.lineas[1].precioLinea).toBe(1_650_000) // 1.100.000 × 1,50
    expect(c.lineas[1].margenPropio).toBe(true)
    expect(c.ventaBruta).toBe(2_970_000)
  })

  it('margen 0 en la línea es un margen, no un campo vacío', () => {
    const c = calcularCascada([item({ margen_porcentaje: 0 })], { margenPct: 30 })
    expect(c.lineas[0].margenAplicado).toBe(0)
    expect(c.precioVenta).toBe(1_000_000)
  })

  it('la convención sobre_venta divide, no multiplica', () => {
    const c = calcularCascada([item({ subtotal: 1_000_000 })], {
      margenPct: 15,
      convencionMargen: 'sobre_venta',
    })
    expect(c.precioVenta).toBe(1_176_471)
    expect(c.margenRealPct).toBeCloseTo(15, 2)
  })

  it('LEGADO: una línea sin costo conserva su precio guardado', () => {
    const c = calcularCascada(
      [item({ subtotal: 0, precio_venta: 12_495_000 })],
      { margenPct: 30, administrativosPct: 10 },
    )
    expect(c.costoDirecto).toBe(0)
    expect(c.precioVenta).toBe(12_495_000)
    expect(c.margenRealPct).toBeCloseTo(100, 6)
  })

  it('LEGADO: un precio fijado a mano no se recalcula ni recibe administrativos', () => {
    const c = calcularCascada(
      [item({ precio_manual: true, precio_venta: 5_000_000 })],
      { margenPct: 30, administrativosPct: 10 },
    )
    expect(c.costoDirecto).toBe(1_000_000)
    expect(c.precioVenta).toBe(5_000_000)
  })

  it('sin precio no hay margen que reportar', () => {
    expect(calcularCascada([], { margenPct: 20 }).margenRealPct).toBeNull()
  })
})
