/**
 * El IVA sobre el ingreso propio, visto en el EDITOR de la cotización (regla de Felipe del
 * 2026-09-22, brief `brief-max-2026-09-22-iva-sobre-el-ingreso-propio.md`).
 *
 * ⚠️ Por qué RENDER: `iva-cotizacion.test.ts` prueba la cuenta, pero el editor puede tenerla
 * bien calculada y pintar la de siempre (19 % del total). Es la tercera superficie que tiene
 * que decir la misma cifra que el PDF y «Aprobar»; si no lo dice, el comercial le cotiza al
 * cliente un número y el documento le llega con otro.
 *
 * Cada caso se afirma también por la NEGATIVA: con la base apagada (el defecto de todos los
 * workspaces) el editor tiene que decir exactamente lo de antes.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

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

const { default: CotizacionEditor } = await import('./cotizacion-editor')

/** La agencia: responsable de IVA, perfil completo. */
const PERFIL = {
  is_complete: true,
  person_type: 'persona_juridica',
  tax_regime: 'ordinario',
  iva_responsible: true,
  is_declarante: true,
  self_withholder: false,
  ica_city: '',
}

/** Un viajero persona natural: no retiene nada, así que el total es precio + IVA. */
const CLIENTE = {
  person_type: 'persona_natural',
  tax_regime: 'ordinario',
  agente_retenedor: false,
  gran_contribuyente: false,
}

/** Un vuelo de $1.000.000 de costo al 15 % sobre la venta: precio $1.176.471. */
const VUELO = {
  id: 'item-vuelo', nombre: 'VUELO BOG-MAD', subtotal: 1_000_000, orden: 1, precio_venta: 0,
  descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
  margen_porcentaje: null, precio_manual: false, rubros: [], grupo: null, opcion_de: null,
}

/** Una línea con precio escrito a mano y sin costo cargado: su IVA no se puede calcular. */
const TRASLADO_SIN_COSTO = {
  id: 'item-traslado', nombre: 'TRASLADO AEROPUERTO', subtotal: 0, orden: 2, precio_venta: 300_000,
  descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
  margen_porcentaje: null, precio_manual: true, rubros: [], grupo: null, opcion_de: null,
}

const EN_INGRESO_PROPIO = { base: 'ingreso_propio', enDocumento: 'linea_incluida' } as const

function pintar(items: unknown[], configIva: unknown = undefined) {
  return renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: {
        id: 'cot-1', codigo: 'COT-2026-0002', consecutivo: 'COT-2026-0002', modo: 'detallada',
        estado: 'borrador', descripcion: null, valor_total: 0, margen_porcentaje: 15,
        costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
        convencion_margen: 'sobre_venta',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: items as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fiscalProfile: PERFIL as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFiscal: CLIENTE as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(configIva === undefined ? {} : { configIva: configIva as any }),
    }),
  )
}

const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('el resumen del editor con el IVA sobre el ingreso propio', () => {
  it('el IVA va sobre lo que gana la agencia, no sobre el total', () => {
    const texto = sinEtiquetas(pintar([VUELO], EN_INGRESO_PROPIO))
    // Precio $1.176.471 − costo $1.000.000 = $176.471 de ingreso propio; 19 % = $33.529.
    expect(texto).toContain('IVA sobre la tarifa de la agencia')
    expect(texto).toContain('+$ 33.529')
    expect(texto).toContain('$ 1.210.000')
    expect(texto).not.toContain('IVA que le cobras')
    // El 19 % del total ($223.529) no aparece en ninguna parte.
    expect(texto).not.toContain('223.529')
  })

  it('cada línea deja elegir sobre qué va su IVA y muestra cuánto es', () => {
    const html = pintar([VUELO], EN_INGRESO_PROPIO)
    expect(html).toContain('aria-label="Base del IVA de la línea"')
    expect(sinEtiquetas(html)).toContain('IVA de la línea:')
  })

  it('una línea con precio y sin costo lo dice, y el resumen avisa que el PDF sale en borrador', () => {
    const html = pintar([VUELO, TRASLADO_SIN_COSTO], EN_INGRESO_PROPIO)
    const texto = sinEtiquetas(html)
    // En el encabezado de la línea, que es lo que se ve con la línea cerrada. El mismo texto
    // sale también en el detalle abierto: buscarlo suelto no probaría el encabezado.
    expect(html).toContain('<span class="block text-[10px] font-medium text-amber-700">IVA sin calcular: falta el costo</span>')
    expect(texto).toContain('IVA sin calcular: falta el costo')
    expect(texto).toContain('La línea «TRASLADO AEROPUERTO» tiene precio y no tiene costo')
    expect(texto).toContain('El PDF sale como borrador hasta entonces.')
  })
})

describe('sin la configuración, el editor dice lo de siempre', () => {
  it('19 % del total, con su rótulo de siempre', () => {
    const texto = sinEtiquetas(pintar([VUELO]))
    expect(texto).toContain('IVA que le cobras')
    expect(texto).toContain('+$ 223.529')
    expect(texto).not.toContain('IVA sobre la tarifa de la agencia')
  })

  it('ni selector de base ni marca de costo faltante', () => {
    const html = pintar([VUELO, TRASLADO_SIN_COSTO])
    expect(html).not.toContain('aria-label="Base del IVA de la línea"')
    expect(sinEtiquetas(html)).not.toContain('IVA sin calcular')
    expect(sinEtiquetas(html)).not.toContain('El PDF sale como borrador')
  })
})
