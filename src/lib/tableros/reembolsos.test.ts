import { describe, expect, it } from 'vitest'
import { normalizarReembolsos, reembolsosPorVendedor, type Reembolso } from './reembolsos'

const base: Reembolso = {
  devolucion_id: 'd1',
  negocio_id: 'n1',
  codigo: 'V0494',
  nombre: 'CATHERINE CHACON',
  fecha: '2026-10-08',
  valor: 535714.29,
  monto: 637500,
  motivo: 'La clienta desistió',
  cierre: 'ya_cerrado',
  venta_anulada: true,
  responsable_id: 's1',
  responsable: 'Daniela',
}

describe('normalizarReembolsos', () => {
  it('convierte los numeric que llegan como texto y conserva la lista', () => {
    const r = normalizarReembolsos({
      anio: 2026, mes: 10, reembolsos: 1, negocios: 1, valor: '535714.29', monto: '637500',
      ventas_anuladas: 1,
      detalle: [{ ...base, valor: '535714.29', monto: '637500' }],
      anterior: { reembolsos: 0, valor: 0 },
    })
    expect(r?.valor).toBe(535714.29)
    expect(r?.detalle[0]).toEqual(base)
  })

  it('null cuando la RPC no devolvió nada (guarda o error)', () => {
    expect(normalizarReembolsos(null)).toBeNull()
    expect(normalizarReembolsos({ anio: 2026 })).toBeNull()
  })

  it('un cierre desconocido cae a «abierto», no a otro texto', () => {
    const r = normalizarReembolsos({ detalle: [{ ...base, cierre: 'raro' }] })
    expect(r?.detalle[0].cierre).toBe('abierto')
    expect(r?.anterior).toEqual({ reembolsos: 0, valor: 0 })
  })
})

describe('reembolsosPorVendedor', () => {
  it('suma por vendedor de la misma lista y deja los sin comercial al final', () => {
    const lista: Reembolso[] = [
      base,
      { ...base, devolucion_id: 'd2', valor: 100000.1 },
      { ...base, devolucion_id: 'd3', responsable_id: 's2', responsable: 'Andrés', valor: 900000 },
      { ...base, devolucion_id: 'd4', responsable_id: null, responsable: null, valor: 1 },
    ]
    const filas = reembolsosPorVendedor(lista)
    expect(filas.map((f) => [f.responsable, f.reembolsos, f.valor])).toEqual([
      ['Daniela', 2, 635714.39],
      ['Andrés', 1, 900000],
      ['Sin comercial', 1, 1],
    ])
    const total = filas.reduce((s, f) => s + f.valor, 0)
    expect(total).toBeCloseTo(lista.reduce((s, r) => s + r.valor, 0), 2)
  })

  it('sin reembolsos no hay filas', () => {
    expect(reembolsosPorVendedor([])).toEqual([])
  })
})
