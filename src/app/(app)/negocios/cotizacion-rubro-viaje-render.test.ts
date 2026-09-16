/**
 * El costo por pasajero se guarda como rubro `tarifa` (hallazgo 3 de la prueba del #763), un
 * tipo que el CHECK de `rubros.tipo` admite pero que no está en el selector del editor.
 *
 * ⚠️ Por qué RENDER: la tabla de rubros rotulaba con `TIPOS_RUBRO`, que no conoce `tarifa`,
 * así que la línea habría mostrado el slug crudo. La acción puede escribir bien y la
 * pantalla pintarlo mal; solo el render lo mide.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))
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
vi.mock('@/app/(app)/negocios/pantallazo-actions', () => ({
  leerPantallazoDeItem: async () => ({ ok: false, codigo: 'RX1', motivo: '', instruccion: '' }),
  confirmarLecturaDePantallazo: async () => ({ success: true }),
  descartarPropuestaDePantallazo: async () => ({ success: true }),
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

const rubro = (over: Record<string, unknown>) => ({
  id: 'r-1', tipo: 'tarifa', descripcion: 'Adulto', cantidad: 5, unidad: 'pax',
  valor_unitario: 1907063, valor_total: 9535315, sugerido: false, ...over,
})

function pintar(rubros: unknown[]) {
  return renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: {
        id: 'cot-1', codigo: 'COT-2026-0002', consecutivo: 'COT-2026-0002', modo: 'detallada',
        estado: 'borrador', descripcion: null, valor_total: 0, margen_porcentaje: 15,
        costo_total: 0, fecha_envio: null, fecha_validez: null,
      },
      initialItems: [{
        id: 'item-1', nombre: 'PRUEBA Vuelo LATAM', subtotal: 0, orden: 1, precio_venta: 0,
        descripcion: null, es_ajuste: false, cantidad: 1, grupo: null, opcion_de: null,
        unidad: null, rubros,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }] as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
    }),
  )
}

const celdas = (html: string) =>
  [...html.matchAll(/<td class="py-1\.5 pr-2">([^<]*)<\/td>/g)].map(m => m[1])

describe('los rubros de viaje se rotulan con su nombre, no con el slug', () => {
  it('`tarifa` se lee «Tarifa del proveedor»', () => {
    const html = pintar([rubro({}), rubro({ id: 'r-2', descripcion: 'Niño', cantidad: 1, valor_unitario: 1771063, valor_total: 1771063 })])
    expect(celdas(html)).toContain('Tarifa del proveedor')
    expect(celdas(html)).not.toContain('tarifa')
  })

  it('los del selector siguen igual', () => {
    const html = pintar([rubro({ tipo: 'servicios_prof' })])
    expect(celdas(html)).toContain('Servicios profesionales')
  })
})
