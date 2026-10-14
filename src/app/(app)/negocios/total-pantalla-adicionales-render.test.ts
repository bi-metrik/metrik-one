/**
 * H27 de la prueba Europa (2026-10-14): el editor mostraba un «Total de la cotización» y un plan de
 * pagos por debajo de la Recomendada. La base (`valor_total`), la tabla de tarifas y el PDF sí
 * sumaban los adicionales (la maleta de bodega); la cascada del EDITOR no los recibía.
 *
 * Render y no helper: lo que falló fue el JSX armando su propia lista de líneas. Cifras inventadas.
 *
 * Se vio fallar: quitando `adjuntarAdicionales` del editor, el total vuelve a $ 1.176.471.
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
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({
  agregarAdicional: async () => ({ success: true }),
  eliminarAdicional: async () => ({ success: true }),
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

/** $1.000.000 de costo al 15 % sobre la venta: precio $1.176.471. */
const VUELO = {
  id: 'item-vuelo', nombre: 'VUELO BOG-MAD', subtotal: 1_000_000, orden: 1, precio_venta: 0,
  descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
  margen_porcentaje: null, precio_manual: false, rubros: [], grupo: null, opcion_de: null,
}

/** Dos maletas de bodega de $100.000 de precio cada una: suman $200.000 a la línea. */
const MALETA = {
  id: 'ad-1', item_id: 'item-vuelo', codigo: 'equipaje_bodega', nombre: null, cantidad: 2,
  costo: 85_000, precio: 100_000, moneda: 'COP', tasa_cop: null, origen: 'manual', orden: 1, precio_manual: true,
}

function pintar(conMaleta: boolean) {
  return renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: {
        id: 'cot-1', codigo: 'COT-PRUEBA', consecutivo: 'COT-PRUEBA', modo: 'detallada',
        estado: 'borrador', descripcion: null, valor_total: 0, margen_porcentaje: 15,
        costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
        convencion_margen: 'sobre_venta',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: [VUELO] as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adicionales: { disponible: true, porItem: conMaleta ? { 'item-vuelo': [MALETA] } : {} } as any,
    }),
  )
}

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('H27 · el total de la pantalla incluye los adicionales, como la base y el PDF', () => {
  it('con dos maletas de $100.000 el total es base + maletas', () => {
    expect(texto(pintar(true))).toContain('1.376.471')
  })

  it('sin adicionales el total es el de siempre', () => {
    const t = texto(pintar(false))
    expect(t).toContain('1.176.471')
    expect(t).not.toContain('1.376.471')
  })
})
