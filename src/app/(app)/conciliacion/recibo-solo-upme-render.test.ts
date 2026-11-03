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
  rc3: { comprobante: 701_812, ya_acusado: 0 },
  porcion_upme: null,
  espera_upme: null,
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
    // SOE-029: el valor sale del comprobante UPME del negocio, y es uno por negocio.
    expect(html).toMatch(/comprobante de pago UPME del negocio \(\$\s?701\.812\)/)
    expect(html).toContain('un solo recibo por negocio')
    expect(html).toContain('Este pago fue de')
    expect(html).toContain('1.339.312')
    expect(html).toContain('se abona solo a la factura')
  })

  it('con recibos anteriores, dice cuánto del comprobante ya estaba acusado', () => {
    const html = texto(renderToStaticMarkup(React.createElement(ResumenReciboUpme, {
      pago: pagoMixto({ valor_upme: 701_767, rc3: { comprobante: 701_812, ya_acusado: 45 } }),
    })))

    expect(html).toMatch(/Valor del recibo \$\s?701\.767/)
    expect(html).toMatch(/\(\$\s?701\.812\) menos \$\s?45 ya acusados/)
  })

  it('en un pago de pura tarifa no habla de un honorario que no tiene', () => {
    const html = texto(renderToStaticMarkup(React.createElement(ResumenReciboUpme, {
      pago: pagoMixto({ monto: 701_812, valor_upme: 701_812 }),
    })))

    expect(html).toMatch(/Valor del recibo \$\s?701\.812/)
    expect(html).not.toContain('honorario')
  })

  // SOE-029: con el total en grande, Tesorería creyó que el recibo salía por el pago
  // entero y dejó de emitirlos. La cifra grande es la del recibo.
  it('la fila de un pago mixto pone en grande el valor del recibo y lo consignado en chico', () => {
    const html = renderToStaticMarkup(React.createElement(FilaPago, { pago: pagoMixto(), onCambio: () => {} }))
    const t = texto(html)

    expect(t).toMatch(/Recibo por \$\s?701\.812 consignó \$\s?1\.339\.312/)
    // La cifra en negrilla es la porción UPME, no el monto del pago.
    expect(html).toMatch(/font-bold[^>]*>\$\s?701\.812</)
    expect(html).not.toMatch(/font-bold[^>]*>\$\s?1\.339\.312</)
    expect(t).not.toContain('tarifa UPME')
    expect(t).toContain('Emitir recibo')
  })

  it('la fila de un pago de pura tarifa no repite lo consignado', () => {
    const t = texto(renderToStaticMarkup(React.createElement(FilaPago, {
      pago: pagoMixto({ monto: 701_812, valor_upme: 701_812 }), onCambio: () => {},
    })))

    expect(t).toMatch(/Recibo por \$\s?701\.812/)
    expect(t).not.toContain('consignó')
  })

  it('la fila sin porción UPME sigue mostrando el monto del pago, sin etiqueta', () => {
    for (const valor_upme of [null, 0]) {
      const html = renderToStaticMarkup(React.createElement(FilaPago, {
        pago: pagoMixto({ valor_upme }), onCambio: () => {},
      }))
      expect(html).toMatch(/font-bold[^>]*>\$\s?1\.339\.312</)
      expect(texto(html)).not.toContain('Recibo por')
      expect(texto(html)).not.toContain('consignó')
    }
  })
})

// SOE-035: V0610 mostraba $459.000 (el pago entero) en una fila frenada y Diana leyó que
// los valores no correspondían. La cifra es la porción UPME y el aviso dice qué se espera.
describe('la fila frenada: porción UPME y la espera del pago a la UPME', () => {
  const frenado = (p: Partial<PagoConRecibo> = {}) => pagoMixto({
    monto: 459_000, valor_upme: null, rc3: null, porcion_upme: 12_500,
    espera_upme: 'Aún no se ha pagado a la UPME: el recibo sale cuando se cargue el comprobante de pago UPME en el negocio.',
    ...p,
  })

  it('pone en grande la porción UPME y lo consignado en chico', () => {
    const html = renderToStaticMarkup(React.createElement(FilaPago, { pago: frenado(), onCambio: () => {} }))
    const t = texto(html)

    expect(t).toMatch(/Tarifa UPME \$\s?12\.500 consignó \$\s?459\.000/)
    expect(html).toMatch(/font-bold[^>]*>\$\s?12\.500</)
    expect(html).not.toMatch(/font-bold[^>]*>\$\s?459\.000</)
  })

  it('dice que aún no se ha pagado a la UPME, sin «Falta» y sin botón', () => {
    const t = texto(renderToStaticMarkup(React.createElement(FilaPago, { pago: frenado(), onCambio: () => {} })))

    expect(t).toContain('Aún no se ha pagado a la UPME: el recibo sale cuando se cargue el comprobante')
    expect(t).not.toContain('Falta')
    expect(t).not.toContain('Emitir recibo')
  })

  it('si además falta el RUT, dice las dos cosas', () => {
    const t = texto(renderToStaticMarkup(React.createElement(FilaPago, {
      pago: frenado({ faltantes: ['RUT del cliente'] }), onCambio: () => {},
    })))

    expect(t).toContain('Aún no se ha pagado a la UPME')
    expect(t).toContain('Falta RUT del cliente')
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
