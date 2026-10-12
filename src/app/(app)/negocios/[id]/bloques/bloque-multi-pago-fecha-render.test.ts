/**
 * BloqueDatosMultiPago muestra la fecha de cada pago, tomada del cobro con la misma
 * referencia y el mismo valor, con el formato de SOE-013 (`FechaDelPago`).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))
vi.mock('../../negocio-v2-actions', () => ({
  actualizarBloqueData: async () => ({ error: null }),
  marcarBloqueCompleto: async () => ({ error: null }),
}))

import BloqueDatosMultiPago from './BloqueDatosMultiPago'
import type { NegocioBloque } from '../../negocio-v2-actions'

const PAGOS = [
  { referencia_epayco: '386159602', valor_pago: 500_000 },
  { referencia_epayco: '386159700', valor_pago: 200_000 },
]

const COBROS = [
  { external_ref: '386159602', monto: 500_000, fecha: '2026-09-16', tipo_cobro: 'pago' },
  // El segundo pago no tiene cobro todavía: no se le inventa fecha.
]

function pintar(modo: 'visible' | 'editable', cobros = COBROS) {
  const instancia = { id: 'nb-1', data: { pagos: PAGOS } } as unknown as NegocioBloque
  return renderToStaticMarkup(
    React.createElement(BloqueDatosMultiPago, {
      negocioBloqueId: 'nb-1',
      instancia,
      modo,
      fields: [],
      cobros,
    }),
  )
}

describe('BloqueDatosMultiPago muestra la fecha del pago', () => {
  for (const modo of ['visible', 'editable'] as const) {
    it(`modo ${modo}: la fecha del cobro con la misma referencia`, () => {
      const html = pintar(modo)
      expect(html).toContain('data-fecha-pago="2026-09-16"')
      expect(html).toMatch(/16 (de )?sept?\.? (de )?2026/)
      // Una sola fecha: el pago sin cobro no pinta nada.
      expect(html.match(/data-fecha-pago=/g)).toHaveLength(1)
    })

    it(`modo ${modo}: sin cobros, ninguna fecha`, () => {
      expect(pintar(modo, [])).not.toContain('data-fecha-pago')
    })
  }
})
