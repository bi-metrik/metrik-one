import { describe, it, expect } from 'vitest'
import { baseYTotalGravado, borradorFactura, emailPlausible } from './mapeo'
import type { SiigoConfig } from './client'

const CFG: SiigoConfig = {
  facturaDocumentId: 1,
  reciboDocumentId: 2,
  sellerId: 3,
  productoCode: '22',
  ivaId: 4,
  facturaPaymentId: 5,
  reciboPaymentId: 6,
}

const IVA = 19
const FECHA = '2026-08-19'

/** Lo que Siigo hace con la base que le mandamos: impuesto y total a 2 decimales. */
const totalQueArmaSiigo = (base: number, ivaPct: number) => {
  const impuesto = Math.round(((base * ivaPct) / 100) * 100) / 100
  return Math.round((base + impuesto) * 100) / 100
}

describe('baseYTotalGravado', () => {
  it('el total vuelve al honorario donde 2 decimales lo perdían (V0317/V0319)', () => {
    // 637.500 con base a 2 decimales daba 637.500,01 y Siigo rechazaba la factura.
    expect(baseYTotalGravado(637500, IVA).total).toBe(637500)
    expect(baseYTotalGravado(850000, IVA).total).toBe(850000)
  })

  it('no mueve los montos que ya salían bien (FV-2-231, honorario 318.000)', () => {
    expect(baseYTotalGravado(318000, IVA).total).toBe(318000)
    expect(baseYTotalGravado(318750, IVA)).toEqual({ base: 267857.142857, total: 318750 })
  })

  it('la base nunca pasa de 6 decimales: más los rechaza la API de Siigo', () => {
    for (const monto of [637500, 318000, 1051880, 999999]) {
      const { base } = baseYTotalGravado(monto, IVA)
      expect(Number.isInteger(base * 1e6)).toBe(true)
    }
  })

  it('INVARIANTE: ningún monto del rango operativo descuadra contra Siigo', () => {
    const descuadres: number[] = []
    for (let monto = 1000; monto <= 2000000; monto += 100) {
      const { base, total } = baseYTotalGravado(monto, IVA)
      if (totalQueArmaSiigo(base, IVA) !== total) descuadres.push(monto)
    }
    expect(descuadres).toEqual([])
  })

  it('sin IVA la base es el total, sin arrastrar ruido', () => {
    expect(baseYTotalGravado(637500, 0)).toEqual({ base: 637500, total: 637500 })
  })

  it('un honorario ausente o negativo no inventa valor', () => {
    expect(baseYTotalGravado(0, IVA)).toEqual({ base: 0, total: 0 })
    expect(baseYTotalGravado(-5000, IVA)).toEqual({ base: 0, total: 0 })
    expect(baseYTotalGravado(Number.NaN, IVA)).toEqual({ base: 0, total: 0 })
  })
})

describe('borradorFactura', () => {
  it('el pago que se declara es el total que Siigo va a reconstruir, no el honorario', () => {
    const { payload } = borradorFactura(CFG, '900123456', 637500, FECHA, IVA)
    const base = payload.items[0].price
    expect(payload.payments[0].value).toBe(totalQueArmaSiigo(base, IVA))
  })

  it('sigue exigiendo identificación y honorario antes de armar nada', () => {
    expect(borradorFactura(CFG, '', null, FECHA, IVA).faltantes)
      .toEqual(['identificación', 'honorario aprobado'])
  })

  it('el concepto del catálogo gana sobre el producto por defecto', () => {
    const { payload } = borradorFactura(CFG, '900123456', 318000, FECHA, IVA, { productoCode: '11' })
    expect(payload.items[0].code).toBe('11')
  })
})

/**
 * El correo que se corrige antes de facturar es el que Siigo usa para MANDAR la
 * factura electrónica. Los casos malos son los que de verdad aparecen escritos a
 * mano; los buenos incluyen formas raras pero válidas, que la validación no puede
 * rechazar porque dejarían un caso sin facturar.
 */
describe('emailPlausible', () => {
  it('rechaza lo que nunca va a recibir un correo', () => {
    for (const malo of ['', '   ', 'diana', 'diana@', '@soena.co', 'diana@soena', 'di ana@soena.co']) {
      expect(emailPlausible(malo)).toBe(false)
    }
  })

  it('acepta lo que sí es un correo, incluidas las formas raras', () => {
    for (const bueno of [
      'diana@soena.co',
      'diana.parra+facturas@soena.com.co',
      '  diana@soena.co  ',
      "o'brien@sub.dominio.gov.co",
    ]) {
      expect(emailPlausible(bueno)).toBe(true)
    }
  })
})
