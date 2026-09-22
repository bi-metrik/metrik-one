/**
 * El control de recibos pinta el recibo de la tarifa UPME, y nada más.
 *
 * Brief del 2026-09-22 (Mauricio), reglas 3 y 7:
 *
 *   - el formulario dice «Recibo de caja por el recaudo de la tarifa UPME» y muestra la
 *     porción UPME del pago, no su monto. El texto viejo («acusa la plata que entregó el
 *     cliente») ya no aplica: el recibo ya no acusa el pago entero;
 *   - lo que el abono automático le dejó a Tesorería se pinta como aviso, SIN botón.
 *
 * Una prueba pura no fija que el JSX obedezca: dejar `fmtCOP(pago.monto)` en el formulario
 * sigue verde en `recibos-control.test.ts` y le muestra a Tesorería el valor equivocado.
 * Mismo patrón que `recibo-enlace-render.test.ts`: `renderToStaticMarkup` sin DOM.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type { AbonoParaTesoreria, PagoConRecibo } from '@/lib/actions/recibos-control-actions'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))

import { FilaAbonoAMano, FilaPago, ResumenReciboUpme } from './tab-recibos'

const pagoMixto = (p: Partial<PagoConRecibo> = {}): PagoConRecibo => ({
  cobro_id: 'c-mixto',
  negocio_id: 'neg-1',
  negocio_codigo: 'V0512',
  cliente: 'Cliente de prueba',
  correo: 'cliente@ejemplo.com',
  monto: 1_339_312,
  fecha: '2026-09-21',
  concepto: null,
  estado: 'pendiente',
  recibo_numero: null,
  recibo_url: null,
  recibos: [],
  valor_upme: 701_812,
  componentes_pendientes: [],
  no_aplica_motivo: null,
  facturado: true,
  faltantes: [],
  avisos: [],
  ...p,
})

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('el formulario del recibo: la tarifa UPME, no el pago', () => {
  it('dice qué es: recibo de caja por el recaudo de la tarifa UPME', () => {
    const html = texto(renderToStaticMarkup(React.createElement(ResumenReciboUpme, { pago: pagoMixto() })))

    expect(html).toContain('Recibo de caja por el recaudo de la tarifa UPME')
    // El texto viejo decía otra cosa y ya no es cierto.
    expect(html).not.toContain('acusa la plata que entregó el cliente')
  })

  it('el valor que muestra es la porción UPME, y el monto del pago aparece solo como contexto', () => {
    const html = texto(renderToStaticMarkup(React.createElement(ResumenReciboUpme, { pago: pagoMixto() })))

    // Intl en es-CO separa miles con punto; el símbolo puede ir pegado o no.
    expect(html).toMatch(/Valor del recibo \$\s?701\.812/)
    expect(html).toContain('porción UPME de este pago de')
    expect(html).toContain('1.339.312')
    expect(html).toContain('se abona solo a la factura')
  })

  it('en un pago de pura tarifa no habla de un honorario que no tiene', () => {
    const html = texto(renderToStaticMarkup(React.createElement(ResumenReciboUpme, {
      pago: pagoMixto({ monto: 701_812, valor_upme: 701_812 }),
    })))

    expect(html).toMatch(/Valor del recibo \$\s?701\.812/)
    expect(html).not.toContain('honorario')
  })

  it('la fila de un pago mixto dice cuánto es la tarifa, al lado del monto', () => {
    const html = texto(renderToStaticMarkup(React.createElement(FilaPago, { pago: pagoMixto(), onCambio: () => {} })))

    expect(html).toContain('tarifa UPME')
    expect(html).toContain('701.812')
    expect(html).toContain('Emitir recibo')
  })
})

describe('los abonos a mano: aviso, sin botón', () => {
  const abono: AbonoParaTesoreria = {
    cobro_id: 'c2', negocio_id: 'neg-1', negocio_codigo: 'V0513', cliente: 'Cliente de prueba',
    fecha: '2026-09-17', monto: 450_000, valor: 450_000,
    motivo: 'la factura ya no tenía saldo (sobrepago)', detalle: 'La factura FV-2-543 ya no tiene saldo.',
  }

  it('dice qué pasó y cuánto, y no ofrece ninguna acción', () => {
    const html = renderToStaticMarkup(React.createElement(FilaAbonoAMano, { abono }))
    const t = texto(html)

    expect(t).toContain('V0513')
    expect(t).toContain('Abono a mano en Siigo: la factura ya no tenía saldo (sobrepago)')
    expect(t).toContain('La factura FV-2-543 ya no tiene saldo.')
    expect(t).toContain('450.000')
    expect(html).not.toContain('<button')
  })
})
