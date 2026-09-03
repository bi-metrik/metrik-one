import { describe, it, expect } from 'vitest'
import { precioSeDerivaDeRubros, precioVentaDelItem } from './precio-item'

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
