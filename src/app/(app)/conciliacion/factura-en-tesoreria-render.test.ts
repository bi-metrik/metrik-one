/**
 * Lo que la tarjeta de Tesorería pinta sobre la FACTURA de un caso.
 *
 * Las reglas son puras y viven en `lib/facturacion/factura-del-negocio`; esto fija que el
 * JSX las esté mirando: que un facturado enlace su PDF, que uno sin PDF lo diga en vez de
 * mostrar otro documento, que un cerrado no ofrezca nada, y que la carga manual aparezca
 * donde la ordenó Mauricio (después de Siigo, o directa si no hay Siigo que consultar).
 *
 * Mismo patrón que `tarjeta-retenido-render.test.ts`: `renderToStaticMarkup` sin DOM.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { casoFalso } from '../../../../test/cola-facturacion-doble'
import type { CasoPorFacturar } from '@/lib/actions/facturacion-actions'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))

import { FilaPorFacturar, ofreceCargaManualDirecta } from './conciliacion-client'

const URL_PDF = 'https://drive.google.com/file/d/1XrMeN5uCm0KnETJ3_GlrznswQr04nIlc/view?usp=drivesdk'

const pintar = (caso: CasoPorFacturar, siigoConfigurado = true) =>
  renderToStaticMarkup(
    React.createElement(FilaPorFacturar, {
      caso,
      descarteAbierto: true,
      siigoConfigurado,
      productos: [],
      workspaceNombre: 'SOENA',
      onCambio: () => {},
    }),
  )

const facturada = (p: Partial<CasoPorFacturar> = {}) => casoFalso({
  negocio_id: 'neg-1', codigo: 'V0200', ya_facturado: true, factura_numero: 'FV-2-248',
  factura_pdf_url: URL_PDF, factura_origen: 'emitido_en_siigo',
  carga_manual: { permitida: false, reemplaza: false, razon: 'La factura FV-2-248 la emitió ONE.' },
  honorario: 637_500,
  ...p,
})

describe('la factura en la tarjeta de Tesorería', () => {
  it('un caso facturado enlaza el PDF real', () => {
    const html = pintar(facturada())
    expect(html).toContain('Ver factura')
    expect(html).toContain(`href="${URL_PDF}"`)
    expect(html).not.toContain('Facturada, sin soporte')
  })

  it('facturado sin PDF lo dice, y no enlaza nada', () => {
    const html = pintar(facturada({
      factura_pdf_url: null, factura_sin_pdf: true,
      carga_manual: { permitida: true, reemplaza: false, razon: null },
    }))
    expect(html).toContain('Facturada, sin soporte')
    expect(html).not.toContain('Ver factura')
    // Primero Siigo: la carga manual vive dentro de ese panel.
    expect(html).toContain('Traer el PDF desde Siigo')
    expect(html).not.toContain('Cargar el PDF a mano')
  })

  it('un cerrado facturado se ve, con su factura, y no ofrece ninguna acción', () => {
    const html = pintar(facturada({
      cerrado: true,
      carga_manual: { permitida: false, reemplaza: false, razon: 'El negocio está cerrado.' },
    }))
    expect(html).toContain('Cerrado')
    expect(html).toContain('Ver factura')
    for (const accion of ['Esta factura ya existe', 'Traer el PDF desde Siigo', 'Cargar el PDF a mano',
      'Reemplazar el PDF', 'Revisar y facturar', 'Descartar factura']) {
      expect(html).not.toContain(accion)
    }
  })

  it('un documento de otro emisor NO se muestra como factura: se avisa', () => {
    const html = pintar(casoFalso({
      negocio_id: 'neg-v0089', codigo: 'V0089',
      factura_documento_ajeno: { emisor: '800041629', numero: 'VNYC 638' },
      carga_manual: { permitida: true, reemplaza: true, razon: null },
    }))
    expect(html).toContain('Lo cargado como factura no es de SOENA (VNYC 638, NIT del emisor 800041629)')
    expect(html).not.toContain('Ver factura')
  })

  it('sin Siigo configurado, la carga manual va directo', () => {
    const html = pintar(casoFalso({ negocio_id: 'neg-2', codigo: 'V0300' }), false)
    expect(html).toContain('Cargar el PDF a mano')
  })

  it('un PDF cargado a mano se puede reemplazar desde la tarjeta', () => {
    const html = pintar(facturada({
      factura_origen: 'cargada_manual',
      carga_manual: { permitida: true, reemplaza: true, razon: null },
    }))
    expect(html).toContain('Reemplazar el PDF cargado a mano')
  })

  it('un PDF que trajo Siigo NO ofrece reemplazo', () => {
    expect(pintar(facturada())).not.toContain('Reemplazar el PDF')
  })
})

describe('ofreceCargaManualDirecta', () => {
  it('con Siigo y sin facturar, no va directa: primero se consulta Siigo', () => {
    expect(ofreceCargaManualDirecta(casoFalso(), true)).toBe(false)
    expect(ofreceCargaManualDirecta(casoFalso(), false)).toBe(true)
  })

  it('un descartado no la ofrece (igual que la adopción)', () => {
    expect(ofreceCargaManualDirecta(casoFalso({ descartado: { at: 'x', por: null, motivo: null } }), false)).toBe(false)
  })
})
