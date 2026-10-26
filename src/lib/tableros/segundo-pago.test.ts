import { describe, expect, it } from 'vitest'
import { normalizarSegundoPago, notaSegundoPago, segundoPagoDeVentas } from './segundo-pago'

const caso = (id: string, valor: number | string, responsable_id: string | null, extra = {}) => ({
  negocio_id: id, codigo: `T${id}`, nombre: `Caso ${id}`, fecha_venta: '2026-09-05',
  fecha_pago: '2026-09-20', valor, responsable_id, responsable: null, ...extra,
})

const CRUDO = {
  anio: 2026, mes: 9, umbral_migaja: 1000,
  recibido: {
    total: '714285.72', negocios: 2, de_ventas_del_mes: 357142.86, de_ventas_anteriores: '357142.86',
    detalle: [caso('a', '357142.86', 'v1', { de_venta_del_mes: true }), caso('b', 357142.86, null, { de_venta_del_mes: false })],
  },
  de_ventas_del_mes: {
    total: 600000, negocios: 3,
    detalle: [caso('a', 357142.86, 'v1'), caso('c', 142857.14, 'v1'), caso('d', 100000, null)],
  },
  anterior: { recibido: 0, de_ventas_del_mes: '1338813.45' },
}

describe('normalizarSegundoPago', () => {
  it('convierte los numeric que llegan como texto y conserva el criterio de cada caso', () => {
    const d = normalizarSegundoPago(CRUDO)!
    expect(d.recibido.total).toBeCloseTo(714285.72, 2)
    expect(d.recibido.de_ventas_anteriores).toBeCloseTo(357142.86, 2)
    expect(d.recibido.detalle.map((c) => c.de_venta_del_mes)).toEqual([true, false])
    expect(d.recibido.detalle[0].valor).toBeCloseTo(357142.86, 2)
    // En la cifra de cohorte todos son, por definición, ventas del mes.
    expect(d.de_ventas_del_mes.detalle.every((c) => c.de_venta_del_mes)).toBe(true)
    expect(d.anterior.de_ventas_del_mes).toBeCloseTo(1338813.45, 2)
    expect(d.umbral_migaja).toBe(1000)
  })

  it('devuelve null cuando la RPC no trajo nada (guarda de workspace o error)', () => {
    expect(normalizarSegundoPago(null)).toBeNull()
    expect(normalizarSegundoPago({})).toBeNull()
  })
})

describe('segundoPagoDeVentas', () => {
  it('suma solo los casos del conjunto, de la misma lista que da la cifra del panel', () => {
    const d = normalizarSegundoPago(CRUDO)!
    expect(segundoPagoDeVentas(d, (c) => c.responsable_id === 'v1')).toBeCloseTo(500000, 2)
    expect(segundoPagoDeVentas(d, (c) => c.responsable_id === null)).toBe(100000)
    expect(segundoPagoDeVentas(d, () => false)).toBe(0)
    // Las filas suman el total: no hay forma de que discrepen.
    expect(segundoPagoDeVentas(d, (c) => c.responsable_id === 'v1')
      + segundoPagoDeVentas(d, (c) => c.responsable_id !== 'v1')).toBeCloseTo(d.de_ventas_del_mes.total, 2)
  })
})

describe('notaSegundoPago', () => {
  it('dice de dónde sale cada cifra y cita el umbral que mandó la base', () => {
    expect(notaSegundoPago('recibido', 1000)).toMatch(/^Por fecha de pago/)
    expect(notaSegundoPago('de_ventas_del_mes', 1000)).toMatch(/^Por mes de venta/)
    for (const c of ['recibido', 'de_ventas_del_mes'] as const) {
      expect(notaSegundoPago(c, 1000)).toContain('sin IVA')
      expect(notaSegundoPago(c, 1000)).toContain('50/50')
      expect(notaSegundoPago(c, 1000)).toContain('$1.000')
    }
  })
})
