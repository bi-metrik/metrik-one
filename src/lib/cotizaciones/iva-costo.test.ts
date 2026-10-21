import { describe, expect, it } from 'vitest'

import { casillaIva, conIva, costosDelItem, costoUnitarioSinIva, ivaDeLinea } from './iva-costo'
import { calcularCascada } from './totales'

describe('IVA del proveedor sobre el costo', () => {
  it('sin iva_costo_pct la línea cuesta lo mismo que antes', () => {
    const fila = { rubros: [{ valor_total: 100_000 }, { valor_total: 50_000, sugerido: true }], subtotal: 0 }
    expect(costosDelItem(fila)).toEqual({ numeroDeRubros: 1, costoDeRubros: 100_000, subtotal: 0, costoSinIva: 100_000, ivaPct: 0 })
  })

  it('con 19 % suma el IVA a los rubros y al subtotal; el costo guardado sigue sin IVA', () => {
    expect(costosDelItem({ rubros: [{ valor_total: 100_000 }], subtotal: 100_000, iva_costo_pct: 19 })).toMatchObject({ costoDeRubros: 119_000, subtotal: 119_000, costoSinIva: 100_000, ivaPct: 19 })
    expect(costosDelItem({ rubros: [], subtotal: '200000', iva_costo_pct: '19.00' })).toMatchObject({ numeroDeRubros: 0, subtotal: 238_000 })
    expect(costoUnitarioSinIva({ rubros: [{ valor_total: 100_000 }], subtotal: 119_000, iva_costo_pct: 19 })).toBe(100_000)
    expect(costoUnitarioSinIva({ rubros: [], subtotal: 200_000, iva_costo_pct: 19 })).toBe(200_000)
  })

  it('un porcentaje raro no suma nada', () => {
    expect(conIva(1000, 95)).toBe(1000)
    expect(conIva(1000, -5)).toBe(1000)
    expect(conIva(1000, 'x')).toBe(1000)
  })

  it('recalcula todo: el precio de la línea sale del costo con IVA', () => {
    const sinIva = calcularCascada([{ ...costosDelItem({ rubros: [{ valor_total: 1_000_000 }] }), cantidad: 1 }], { margenPct: 15, convencionMargen: 'sobre_venta' })
    const conIvaCasc = calcularCascada([{ ...costosDelItem({ rubros: [{ valor_total: 1_000_000 }], iva_costo_pct: 19 }), cantidad: 1 }], { margenPct: 15, convencionMargen: 'sobre_venta' })
    expect(sinIva.costoDirecto).toBe(1_000_000)
    expect(conIvaCasc.costoDirecto).toBe(1_190_000)
    expect(conIvaCasc.precioVenta).toBe(Math.round(1_190_000 / 0.85))
    expect(conIvaCasc.margenRealPct).toBeCloseTo(15, 1)
  })

  it('la casilla: lo guardado manda; si nadie la tocó, encendida con proveedor que declara IVA y viajero residente', () => {
    expect(casillaIva({ guardada: null, algunProveedorDeclaraIva: true, viajeroResidente: null })).toEqual({ encendida: true, porDefecto: true })
    expect(casillaIva({ guardada: null, algunProveedorDeclaraIva: true, viajeroResidente: false })).toEqual({ encendida: false, porDefecto: true })
    expect(casillaIva({ guardada: null, algunProveedorDeclaraIva: false, viajeroResidente: true })).toEqual({ encendida: false, porDefecto: true })
    expect(casillaIva({ guardada: false, algunProveedorDeclaraIva: true, viajeroResidente: true })).toEqual({ encendida: false, porDefecto: false })
    expect(ivaDeLinea(true, true)).toBe(19)
    expect(ivaDeLinea(true, null)).toBeNull()
    expect(ivaDeLinea(false, true)).toBeNull()
  })
})
