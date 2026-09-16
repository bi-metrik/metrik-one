/**
 * «+ Vuelo», «+ Hotel», «+ Actividad», «+ Traslado» y «+ Otro» en vez de «nombre + Item»,
 * solo cuando la línea del negocio cotiza por tipo. Sin la marca, la pantalla de siempre.
 *
 * ⚠️ Por qué RENDER: la regla de qué línea cotiza por tipo es pura y tiene su prueba, pero
 * que el JSX la obedezca (y que los demás workspaces sigan viendo el input) solo se mide
 * pintando.
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

function pintar(lineasPorTipo?: boolean) {
  return renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: {
        id: 'cot-1', codigo: 'COT-2026-0002', consecutivo: 'COT-2026-0002', modo: 'detallada',
        estado: 'borrador', descripcion: null, valor_total: 0, margen_porcentaje: 15,
        costo_total: 0, fecha_envio: null, fecha_validez: null,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: [] as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      ...(lineasPorTipo === undefined ? {} : { lineasPorTipo }),
    }),
  )
}

/** El texto de cada botón, sin el ícono. */
const botones = (html: string) =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim())

describe('agregar líneas por tipo', () => {
  it('sin la marca: el input de nombre y el botón «Item», como siempre', () => {
    const html = pintar()
    expect(html).toContain('placeholder="Nombre del item..."')
    expect(botones(html)).toContain('Item')
    expect(botones(html)).toContain('Desde catálogo')
    for (const t of ['Vuelo', 'Hotel', 'Actividad', 'Traslado', 'Otro']) expect(botones(html)).not.toContain(t)
  })

  it('con la marca: un botón por tipo, «Otro» y el catálogo; el nombre libre no está a la vista', () => {
    const html = pintar(true)
    expect(botones(html)).toEqual(expect.arrayContaining(['Vuelo', 'Hotel', 'Actividad', 'Traslado', 'Otro', 'Desde catálogo']))
    expect(botones(html)).not.toContain('Item')
    expect(html).not.toContain('placeholder="Nombre del item..."')
    expect(html).not.toContain('placeholder="Nombre de la línea..."')
  })
})
