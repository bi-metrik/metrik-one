/**
 * SOE-013: cada pago del bloque «Pagos» (ePayco) muestra la fecha del PAGO.
 *
 * La fuente es `cobros.fecha` del mismo negocio, enlazada por `external_ref = ref_payco`.
 * `pagos[].fecha` de los pagos viejos es el día del registro en ONE: V0136 (ref
 * 386159602) decía 17-sep en el bloque y 16-sep en el cobro. Si no hay cobro con esa
 * referencia, se usa `pagos[].fecha` como respaldo.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/components/distribuir-pago-modal', () => ({ default: () => null }))
vi.mock('@/lib/actions/epayco-actions', () => ({
  consultarEpayco: async () => ({ success: false, error: '' }),
  registrarPagoEpayco: async () => ({ success: false, error: '' }),
}))

import BloquePagosEpayco from './BloquePagosEpayco'
import { fechaDelPagoEpayco } from '@/lib/epayco/fecha-de-pago'
import type { NegocioBloque } from '../../negocio-v2-actions'

const PAGO_V0136 = {
  ref_payco: 386159602,
  monto_bruto: 1_339_312,
  pagador_nombre: 'Pagador de prueba',
  total_descuentos: 35_700,
  monto_neto: 1_303_612,
  tipo_cobro: 'pago',
  fecha: '2026-09-17', // día del registro, no del pago
}

const COBRO_V0136 = { external_ref: '386159602', fecha: '2026-09-16' }

function pintar(modo: 'visible' | 'editable', cobros: Array<{ external_ref: string | null; fecha: string | null }>) {
  const instancia = { id: 'nb-1', data: { pagos: [PAGO_V0136] } } as unknown as NegocioBloque
  return renderToStaticMarkup(
    React.createElement(BloquePagosEpayco, {
      negocioBloqueId: 'nb-1',
      negocioId: 'n-v0136',
      instancia,
      modo,
      tipoCobro: 'pago',
      cobros,
    }),
  )
}

describe('fechaDelPagoEpayco', () => {
  it('sale del cobro con la misma referencia', () => {
    expect(fechaDelPagoEpayco(PAGO_V0136, [COBRO_V0136])).toBe('2026-09-16')
  })

  it('no toma el cobro de otra referencia', () => {
    expect(fechaDelPagoEpayco(PAGO_V0136, [{ external_ref: '386159603', fecha: '2026-09-01' }])).toBe('2026-09-17')
  })

  it('sin cobro que coincida, usa pagos[].fecha de respaldo', () => {
    expect(fechaDelPagoEpayco(PAGO_V0136, [])).toBe('2026-09-17')
  })

  it('un cobro con la referencia pero sin fecha no tapa el respaldo', () => {
    expect(fechaDelPagoEpayco(PAGO_V0136, [{ external_ref: '386159602', fecha: null }])).toBe('2026-09-17')
  })

  it('sin cobro ni fecha guardada, no hay fecha', () => {
    expect(fechaDelPagoEpayco({ ref_payco: 1, fecha: undefined }, [])).toBeNull()
  })
})

describe('el bloque Pagos muestra la fecha del pago', () => {
  for (const modo of ['visible', 'editable'] as const) {
    it(`modo ${modo}: la fecha del cobro, no la del registro`, () => {
      const html = pintar(modo, [COBRO_V0136])
      expect(html).toContain('data-fecha-pago="2026-09-16"')
      expect(html).not.toContain('data-fecha-pago="2026-09-17"')
      expect(html).toMatch(/16 (de )?sept?\.? (de )?2026/)
    })

    it(`modo ${modo}: sin cobro, el respaldo de pagos[].fecha`, () => {
      const html = pintar(modo, [])
      expect(html).toContain('data-fecha-pago="2026-09-17"')
    })
  }
})
