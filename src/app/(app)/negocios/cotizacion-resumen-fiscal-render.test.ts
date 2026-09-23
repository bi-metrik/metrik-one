/**
 * El editor de la cotización tras el ensayo del 2026-09-23 (brief de Max «Texto para el
 * cliente» y términos):
 *
 *   - hallazgo 33: Trappvel no ve el resumen fiscal del final («El cliente te factura y
 *     paga / De eso, no todo es tuyo / Te queda en caja»); los demás lo siguen viendo;
 *   - C1/C2: con el panel «Texto para el cliente», los términos viven en el panel y el
 *     cuadro de abajo desaparece; sin el panel, el cuadro de siempre.
 *
 * Cada caso se afirma también por la negativa (R6): sin las props nuevas, el editor dice
 * exactamente lo de antes.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { PanelTextoCliente } from '@/lib/cotizaciones/documento-cliente'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({
  updateCotizacion: async () => ({ success: true }),
  enviarCotizacion: async () => ({ success: true }),
  duplicarCotizacion: async () => ({ success: true }),
  addItem: async () => ({ success: true }),
  updateItem: async () => ({ success: true }),
  deleteItem: async () => ({ success: true }),
  addRubro: async () => ({ success: true }),
  updateRubro: async () => ({ success: true }),
  deleteRubro: async () => ({ success: true }),
  recalcularTotales: async () => ({ success: true }),
  addItemFromServicio: async () => ({ success: true }),
  aplicarAIU: async () => ({ success: true }),
  getRastroDeMargen: async () => ({ ok: true, entradas: [], alcance: 'negocio' }),
}))
vi.mock('@/app/(app)/config/servicios-actions', () => ({ getServiciosActivos: async () => [] }))
vi.mock('@/app/(app)/negocios/cotizacion-pdf-actions', () => ({
  generateCotizacionPDF: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/documento-cliente-actions', () => ({
  redactarDocumentoCliente: async () => ({ success: false, error: 'x' }),
  guardarDocumentoCliente: async () => ({ success: false, error: 'x' }),
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

const PERFIL = {
  is_complete: true,
  person_type: 'persona_juridica',
  tax_regime: 'ordinario',
  iva_responsible: true,
  is_declarante: true,
  self_withholder: false,
  ica_city: '',
}
const CLIENTE = { person_type: 'persona_natural', tax_regime: 'ordinario', agente_retenedor: false, gran_contribuyente: false }

const VUELO = {
  id: 'item-vuelo', nombre: 'VUELO BOG-CUN', subtotal: 1_000_000, orden: 1, precio_venta: 0,
  descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
  margen_porcentaje: null, precio_manual: false, rubros: [], grupo: null, opcion_de: null,
}
/** Precio escrito a mano y sin costo: con el IVA sobre el ingreso propio, no se puede calcular. */
const TRASLADO_SIN_COSTO = {
  id: 'item-traslado', nombre: 'TRASLADO AEROPUERTO', subtotal: 0, orden: 2, precio_venta: 300_000,
  descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
  margen_porcentaje: null, precio_manual: true, rubros: [], grupo: null, opcion_de: null,
}
const IVA_ADENTRO = { base: 'ingreso_propio', enDocumento: 'linea_incluida', precio: 'iva_incluido' } as const

const PANEL: PanelTextoCliente = {
  columnaPresente: true,
  documento: null,
  desactualizado: false,
  hayViaje: true,
  editable: true,
  terminos: null,
  terminosBase: null,
}

function pintar(extra: Record<string, unknown> = {}, items: unknown[] = [VUELO]) {
  return renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: {
        id: 'cot-1', codigo: 'COT-2026-0009', consecutivo: 'COT-2026-0009', modo: 'detallada',
        estado: 'borrador', descripcion: null, valor_total: 0, margen_porcentaje: 15,
        costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
        convencion_margen: 'sobre_venta', terminos_condiciones: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: items as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fiscalProfile: PERFIL as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFiscal: CLIENTE as any,
      ...extra,
    }),
  )
}

const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('hallazgo 33 · el resumen fiscal del final', () => {
  it('R6 · sin decir nada, el editor lo pinta como siempre', () => {
    const t = sinEtiquetas(pintar())
    expect(t).toContain('EL CLIENTE TE FACTURA Y PAGA')
    expect(t).toContain('DE ESO, NO TODO ES TUYO')
    expect(t).toContain('TE QUEDA EN CAJA')
  })

  it('⚠️ con la plantilla que lo oculta (Trappvel) no sale ninguno de los tres bloques', () => {
    const t = sinEtiquetas(pintar({ mostrarResumenFiscal: false }))
    expect(t).not.toContain('EL CLIENTE TE FACTURA Y PAGA')
    expect(t).not.toContain('DE ESO, NO TODO ES TUYO')
    expect(t).not.toContain('TE QUEDA EN CAJA')
    expect(t).not.toContain('Te ganas')
    // Tampoco su versión sin perfil fiscal.
    expect(sinEtiquetas(pintar({ mostrarResumenFiscal: false, fiscalProfile: null }))).not.toContain('TÚ RECIBES')
  })

  it('⚠️⚠️ sin el resumen, el aviso de un IVA sin calcular NO se pierde: cambia lo que sale en el PDF', () => {
    const t = sinEtiquetas(pintar({ mostrarResumenFiscal: false, configIva: IVA_ADENTRO }, [VUELO, TRASLADO_SIN_COSTO]))
    expect(t).toContain('La línea «TRASLADO AEROPUERTO» tiene precio y no tiene costo')
    expect(t).toContain('El PDF sale como borrador, con la marca «IVA sin calcular», hasta entonces.')
    expect(t).not.toContain('EL CLIENTE TE FACTURA Y PAGA')
    // Con el IVA calculable no hay aviso suelto.
    expect(sinEtiquetas(pintar({ mostrarResumenFiscal: false, configIva: IVA_ADENTRO }))).not.toContain('El PDF sale como borrador, con la marca «IVA sin calcular»')
  })
})

describe('C1/C2 · los términos viven en el panel «Texto para el cliente»', () => {
  const CUADRO = 'Validez de la oferta, garantía, alcance, condiciones de entrega'

  it('R6 · sin el panel (otras plantillas), el cuadro de términos de siempre', () => {
    expect(pintar()).toContain(CUADRO)
  })

  it('⚠️ con el panel, el cuadro de abajo no se pinta: un solo lugar y un solo guardar', () => {
    expect(pintar({ textoCliente: PANEL })).not.toContain(CUADRO)
  })

  it('sin la columna del panel (migración pendiente), vuelve el cuadro de siempre', () => {
    expect(pintar({ textoCliente: { ...PANEL, columnaPresente: false } })).toContain(CUADRO)
  })

  it('un borrador con términos por proponer lo avisa en el botón «Texto»', () => {
    expect(pintar({ textoCliente: { ...PANEL, terminosBase: 'Condiciones generales\n- Sujeto a disponibilidad.' } }))
      .toContain('aria-label="Términos sin guardar"')
    expect(pintar({ textoCliente: PANEL })).not.toContain('aria-label="Términos sin guardar"')
    expect(pintar({ textoCliente: { ...PANEL, terminos: 'Ya guardados.', terminosBase: 'Base.' } }))
      .not.toContain('aria-label="Términos sin guardar"')
  })
})
