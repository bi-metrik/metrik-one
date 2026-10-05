import { describe, expect, it } from 'vitest'
import { contratoOnePagado, type FilaMisServicios } from './contrato-one'

// Termotech (2026-10-05): paga su licencia de ONE (`licencia-clarity`, módulo `business`).
const fila = (p: Partial<FilaMisServicios>): FilaMisServicios => ({
  servicio_contratado_id: 'sc-1',
  modulo: 'business',
  estado: 'activo',
  es_pagador: true,
  vigente_desde: '2026-09-05',
  ...p,
})

describe('el contrato de la licencia de ONE que paga el espacio', () => {
  it('un contrato de Clarity activo que el espacio paga', () => {
    expect(contratoOnePagado([fila({})])?.servicio_contratado_id).toBe('sc-1')
  })

  it('no lo es si el espacio no lo paga (beneficiario o pagado por MeTRIK)', () => {
    expect(contratoOnePagado([fila({ es_pagador: false })])).toBeNull()
    expect(contratoOnePagado([fila({ es_pagador: null })])).toBeNull()
  })

  it('otros módulos no entran por aquí: Valida tiene su propia puerta, el Radar y Sustenta no tienen sección', () => {
    for (const modulo of ['valida_consulta', 'valida_api', 'radar_secop', 'compliance']) {
      expect(contratoOnePagado([fila({ modulo })])).toBeNull()
    }
  })

  it('solo los que cobran: ni el borrador ni el cancelado o terminado', () => {
    for (const estado of ['borrador', 'cancelado', 'terminado']) {
      expect(contratoOnePagado([fila({ estado })])).toBeNull()
    }
    expect(contratoOnePagado([fila({ estado: 'pausado' })])?.servicio_contratado_id).toBe('sc-1')
  })

  it('con varios, el activo antes que el pausado, y luego el más reciente', () => {
    const elegido = contratoOnePagado([
      fila({ servicio_contratado_id: 'pausado-nuevo', estado: 'pausado', vigente_desde: '2026-10-01' }),
      fila({ servicio_contratado_id: 'activo-viejo', vigente_desde: '2026-01-01' }),
      fila({ servicio_contratado_id: 'activo-nuevo', vigente_desde: '2026-09-05' }),
    ])
    expect(elegido?.servicio_contratado_id).toBe('activo-nuevo')
  })
})
