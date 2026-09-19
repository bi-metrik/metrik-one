/**
 * El enlace al PDF del recibo de caja, en el control de recibos de Tesoreria.
 *
 * Las reglas son puras y viven en `lib/almacenamiento/archivo-de-cobro`; esto fija que el
 * JSX las este mirando. Hace falta como prueba aparte porque una prueba pura no mata la
 * mutacion que importa aqui: dejar `href={pago.recibo_url}` sigue verde en el helper y
 * manda al usuario a drive.google.com, que es justo lo que este frente cierra.
 *
 * Mismo patron que `factura-en-tesoreria-render.test.ts`: `renderToStaticMarkup` sin DOM.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type { PagoConRecibo } from '@/lib/actions/recibos-control-actions'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))

import { FilaPago } from './tab-recibos'

const URL_DRIVE = 'https://drive.google.com/file/d/1S0NXc_Qpj8h-pm_esV_hTFNeYydSQJO9/view?usp=drivesdk'
const COBRO = '4013ee2b-6bb9-4454-9a11-0b1c2d3e4f50'

function pagoFalso(p: Partial<PagoConRecibo> = {}): PagoConRecibo {
  return {
    cobro_id: COBRO,
    negocio_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    negocio_codigo: 'V0200',
    cliente: 'Cliente de prueba',
    correo: null,
    monto: 701_812,
    fecha: '2026-09-01',
    concepto: null,
    estado: 'con_recibo',
    recibo_numero: 'RC-1-65',
    recibo_url: URL_DRIVE,
    recibos: [{ numero: 'RC-1-65', url: URL_DRIVE, componente: null }],
    componentes_pendientes: [],
    no_aplica_motivo: null,
    facturado: false,
    faltantes: [],
    avisos: [],
    ...p,
  }
}

const pintar = (pago: PagoConRecibo): string =>
  renderToStaticMarkup(React.createElement(FilaPago, { pago, onCambio: () => {} }))

describe('el enlace al PDF del recibo', () => {
  it('NO manda a Drive: pasa por la ruta de ONE, con el id del cobro', () => {
    const html = pintar(pagoFalso())
    expect(html).toContain(`href="/api/archivos/cobro?cobro=${COBRO}&amp;doc=recibo"`)
    expect(html).not.toContain('drive.google.com')
    expect(html).toContain('RC-1-65')
  })

  it('un recibo sin PDF archivado lo dice, y no enlaza nada', () => {
    const html = pintar(pagoFalso({
      recibo_url: null,
      recibos: [{ numero: 'RC-1-65', url: null, componente: null }],
    }))
    expect(html).toContain('sin PDF')
    expect(html).not.toContain('/api/archivos/cobro')
  })

  // ── El pago mixto: DOS documentos en la misma fila ──
  //
  // Mostrar solo el primero escondería un recibo que ya consumió numeración en la
  // contabilidad del cliente, que es exactamente el trabajo que este panel existe para
  // no esconder (PR #581).
  it('un pago con dos recibos enlaza los DOS, cada uno a su documento', () => {
    const html = pintar(pagoFalso({
      recibo_numero: 'RC-1-70',
      recibos: [
        { numero: 'RC-1-70', url: URL_DRIVE, componente: 'honorario' },
        { numero: 'RC-9-3', url: URL_DRIVE, componente: 'pasante' },
      ],
    }))
    expect(html).toContain('RC-1-70')
    expect(html).toContain('RC-9-3')
    expect(html).toContain(`doc=recibo"`)
    expect(html).toContain(`doc=recibo_pasante"`)
    expect(html).not.toContain('drive.google.com')
  })

  it('cuando falta un componente, la fila dice CUÁL y ofrece completarlo', () => {
    const html = pintar(pagoFalso({
      estado: 'pendiente',
      recibos: [{ numero: 'RC-1-70', url: URL_DRIVE, componente: 'honorario' }],
      componentes_pendientes: ['pasante'],
    }))
    expect(html).toContain('Completar recibos')
    expect(html).toContain('Falta el recibo de la plata de terceros')
    // Y no se lee como "emitir el primero", que es lo que invitaría a duplicar.
    expect(html).not.toContain('Emitir recibo')
  })
})
