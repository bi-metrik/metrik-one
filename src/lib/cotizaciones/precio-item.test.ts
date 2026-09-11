import { describe, it, expect } from 'vitest'
import { precioSeDerivaDeRubros, precioVentaDelItem, costoUnitarioDelItem, margenRealDelItem } from './precio-item'

/**
 * Los cuatro escenarios de la prueba de escritorio del encargo, más los bordes
 * que separan "el sistema deriva el precio" de "una persona lo escribió".
 */
describe('precio de venta de un ítem de cotización', () => {
  it('3 rubros y margen 0: el precio ES el costo, ya no cero', () => {
    // 3 rubros: 500.000 + 300.000 + 200.000 = 1.000.000 de costo unitario
    const item = {
      numeroDeRubros: 3,
      subtotal: 1_000_000,
      margen_porcentaje: 0,
      precio_manual: false,
      precio_venta: 0,
    }
    expect(precioSeDerivaDeRubros(item)).toBe(true)
    expect(precioVentaDelItem(item)).toBe(1_000_000)
  })

  it('margen 20 sobre el costo de rubros', () => {
    const item = {
      numeroDeRubros: 3,
      subtotal: 1_000_000,
      margen_porcentaje: 20,
      precio_manual: false,
      precio_venta: 0,
    }
    expect(precioVentaDelItem(item)).toBe(1_200_000)
  })

  it('sin rubros: conserva el precio escrito y nadie lo deriva', () => {
    const item = {
      numeroDeRubros: 0,
      subtotal: 0,
      margen_porcentaje: 0,
      precio_manual: false,
      precio_venta: 750_000,
    }
    expect(precioSeDerivaDeRubros(item)).toBe(false)
    expect(precioVentaDelItem(item)).toBe(750_000)
  })

  it('precio sobreescrito: el margen no lo toca aunque haya rubros', () => {
    const item = {
      numeroDeRubros: 3,
      subtotal: 1_000_000,
      margen_porcentaje: 20,
      precio_manual: true,
      precio_venta: 900_000,
    }
    expect(precioSeDerivaDeRubros(item)).toBe(false)
    expect(precioVentaDelItem(item)).toBe(900_000)
  })

  it('el ítem de ajuste nunca se deriva: lo gestiona la reconciliación', () => {
    const item = {
      es_ajuste: true,
      numeroDeRubros: 0,
      subtotal: 0,
      precio_venta: -180_000,
    }
    expect(precioSeDerivaDeRubros(item)).toBe(false)
    expect(precioVentaDelItem(item)).toBe(-180_000)
  })

  // El ítem de ajuste hoy nunca tiene rubros, así que el guard de rubros lo tapa.
  // Sin este caso, quitar el guard de `es_ajuste` no rompe ninguna prueba y la
  // suite dejaría pasar que la reconciliación pierda el control de su propio ítem.
  it('el ajuste no se deriva ni cuando alguien le cuelga rubros', () => {
    const item = {
      es_ajuste: true,
      numeroDeRubros: 2,
      subtotal: 1_000_000,
      margen_porcentaje: 20,
      precio_manual: false,
      precio_venta: -180_000,
    }
    expect(precioSeDerivaDeRubros(item)).toBe(false)
    expect(precioVentaDelItem(item)).toBe(-180_000)
  })

  it('margen nulo cuenta como 0, no rompe ni deja el ítem en cero', () => {
    const item = {
      numeroDeRubros: 2,
      subtotal: 96_507,
      margen_porcentaje: null,
      precio_manual: false,
      precio_venta: 0,
    }
    expect(precioVentaDelItem(item)).toBe(96_507)
  })

  it('redondea a peso: el margen no deja decimales en el precio', () => {
    const item = {
      numeroDeRubros: 2,
      subtotal: 71_132,
      margen_porcentaje: 33.33,
      precio_manual: false,
      precio_venta: 0,
    }
    expect(precioVentaDelItem(item)).toBe(Math.round(71_132 * 1.3333))
    expect(Number.isInteger(precioVentaDelItem(item))).toBe(true)
  })

  it('margen negativo: se aplica tal cual, es un descuento sobre el costo', () => {
    const item = {
      numeroDeRubros: 1,
      subtotal: 1_000_000,
      margen_porcentaje: -10,
      precio_manual: false,
      precio_venta: 0,
    }
    expect(precioVentaDelItem(item)).toBe(900_000)
  })

  it('precio_manual ausente se lee como falso: el ítem con rubros se deriva', () => {
    const item = { numeroDeRubros: 1, subtotal: 500_000, precio_venta: 0 }
    expect(precioSeDerivaDeRubros(item)).toBe(true)
    expect(precioVentaDelItem(item)).toBe(500_000)
  })
})

describe('costoUnitarioDelItem', () => {
  it('con rubros, el costo lo mandan ellos aunque haya un subtotal escrito a mano', () => {
    expect(costoUnitarioDelItem({ numeroDeRubros: 2, costoDeRubros: 800_000, subtotal: 999_999 })).toBe(800_000)
  })

  it('sin rubros, el costo es el subtotal escrito a mano', () => {
    expect(costoUnitarioDelItem({ numeroDeRubros: 0, subtotal: 12_495_000 })).toBe(12_495_000)
  })

  it('sin rubros y sin costo escrito, es cero y no un NaN', () => {
    expect(costoUnitarioDelItem({ numeroDeRubros: 0, subtotal: null })).toBe(0)
    expect(costoUnitarioDelItem({ numeroDeRubros: 0 })).toBe(0)
  })

  it('un item de compra directa deja de valer cero: es el caso que rompia costo_total', () => {
    // COT-2026-0003 de Termotech: 12 items con precio de venta y sin un solo rubro.
    const items = [
      { numeroDeRubros: 0, subtotal: 9_500_000, cantidad: 1 },
      { numeroDeRubros: 0, subtotal: 8_000_000, cantidad: 1 },
      { numeroDeRubros: 2, costoDeRubros: 1_000_000, cantidad: 3 },
    ]
    const costoTotal = items.reduce((s, i) => s + costoUnitarioDelItem(i) * i.cantidad, 0)
    expect(costoTotal).toBe(20_500_000)
  })
})

/**
 * La convención del margen. El caso que la motiva es real: Trappvel cotiza con
 * divisores (`costo / 0,85`) y escribe 15 queriendo decir margen real. Con la
 * convención de siempre ese 15 valía 13,04% y nada en pantalla lo delataba.
 */
describe('convención del margen', () => {
  const base = { numeroDeRubros: 3, subtotal: 1_000_000, precio_manual: false, precio_venta: 0 }

  it('sin convención declarada calcula como siempre: markup sobre el costo', () => {
    expect(precioVentaDelItem({ ...base, margen_porcentaje: 15 })).toBe(1_150_000)
  })

  it('markup explícito da exactamente lo mismo que no declarar nada', () => {
    const item = { ...base, margen_porcentaje: 15, convencion_margen: 'markup' as const }
    expect(precioVentaDelItem(item)).toBe(1_150_000)
  })

  it('sobre_venta al 15 reproduce el divisor /0,85 del Excel de la agencia', () => {
    const item = { ...base, margen_porcentaje: 15, convencion_margen: 'sobre_venta' as const }
    // 1.000.000 / 0,85 = 1.176.470,588…
    expect(precioVentaDelItem(item)).toBe(1_176_471)
  })

  it('el margen real del precio sobre_venta ES el número escrito', () => {
    const item = { ...base, margen_porcentaje: 15, convencion_margen: 'sobre_venta' as const }
    const margen = margenRealDelItem(1_000_000, precioVentaDelItem(item))
    expect(margen).toBeCloseTo(15, 3)
  })

  it('el margen real del precio markup NO es el número escrito, y esa es la trampa', () => {
    const margen = margenRealDelItem(1_000_000, precioVentaDelItem({ ...base, margen_porcentaje: 15 }))
    expect(margen).toBeCloseTo(13.043, 3)
  })

  it('margen 0 da el costo con cualquiera de las dos convenciones', () => {
    expect(precioVentaDelItem({ ...base, margen_porcentaje: 0, convencion_margen: 'sobre_venta' })).toBe(1_000_000)
    expect(precioVentaDelItem({ ...base, margen_porcentaje: 0, convencion_margen: 'markup' })).toBe(1_000_000)
  })

  it('sobre_venta al 100 no divide por cero: cae a markup', () => {
    const item = { ...base, margen_porcentaje: 100, convencion_margen: 'sobre_venta' as const }
    expect(precioVentaDelItem(item)).toBe(2_000_000)
  })

  it('sobre_venta por encima de 100 no devuelve un precio negativo', () => {
    const item = { ...base, margen_porcentaje: 150, convencion_margen: 'sobre_venta' as const }
    expect(precioVentaDelItem(item)).toBeGreaterThan(1_000_000)
  })

  it('un precio escrito a mano ignora la convención, como ignora el margen', () => {
    const item = { ...base, margen_porcentaje: 15, precio_manual: true, precio_venta: 900_000, convencion_margen: 'sobre_venta' as const }
    expect(precioVentaDelItem(item)).toBe(900_000)
  })

  it('sin precio no hay margen que reportar, y no es cero', () => {
    expect(margenRealDelItem(500_000, 0)).toBeNull()
  })
})
