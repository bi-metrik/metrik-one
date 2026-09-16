/**
 * El enlace al PDF del recibo dentro del bloque de Cobros de la ficha del negocio.
 *
 * Es la tercera superficie que pintaba el enlace crudo de Drive (las otras dos son el
 * panel de pagos externos y el control de recibos de Tesoreria) y la unica que ni
 * siquiera pasaba por `hrefArchivo`: mandaba el valor de la columna tal cual. Esta prueba
 * fija que ahora vaya por `/api/archivos/cobro`.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('./plan-recurrente-actions', () => ({ confirmarCobroProgramado: async () => ({ ok: true }) }))
vi.mock('@/components/distribuir-pago-modal', () => ({ default: () => null }))

import { ReciboDelPago } from './BloqueCobros'

const URL_DRIVE = 'https://drive.google.com/file/d/1S0NXc_Qpj8h-pm_esV_hTFNeYydSQJO9/view?usp=drivesdk'
const COBRO = '4013ee2b-6bb9-4454-9a11-0b1c2d3e4f50'

type Cobro = Parameters<typeof ReciboDelPago>[0]['cobro']

function cobroFalso(siigo_recibo: Cobro['siigo_recibo']): Cobro {
  return {
    id: COBRO,
    concepto: null,
    monto: 701_812,
    revisado: false,
    tipo_cobro: 'pago',
    fecha: '2026-09-01',
    fecha_esperada: null,
    numero_cuota: null,
    vencido: false,
    notas: null,
    external_ref: null,
    siigo_recibo,
  }
}

const pintar = (recibo: Cobro['siigo_recibo']): string =>
  renderToStaticMarkup(React.createElement(ReciboDelPago, { cobro: cobroFalso(recibo) }))

describe('el recibo dentro del bloque de Cobros', () => {
  it('NO manda a Drive: pasa por la ruta de ONE, con el id del cobro', () => {
    const html = pintar({ numero: 'RC-1-65', archivo_url: URL_DRIVE })
    expect(html).toContain(`href="/api/archivos/cobro?cobro=${COBRO}&amp;doc=recibo"`)
    expect(html).not.toContain('drive.google.com')
    expect(html).toContain('RC-1-65')
  })

  it('un recibo cargado a mano (sin PDF en Drive) lo dice, y no enlaza nada', () => {
    const html = pintar({ numero: 'RC-2026-09-001', archivo_url: null })
    expect(html).toContain('sin PDF')
    expect(html).not.toContain('<a')
  })

  it('sin numero no se dice nada', () => {
    expect(pintar(null)).toBe('')
  })
})
