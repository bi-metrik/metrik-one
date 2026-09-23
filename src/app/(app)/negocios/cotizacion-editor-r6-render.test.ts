/**
 * R6 del rediseño del editor (brief del 2026-09-23): los pasos guiados, los bloques por
 * tipo y la opción abierta son SOLO de Trappvel (`lineasPorTipo`). Termotech, Arca y WMC
 * tienen que ver su editor EXACTAMENTE igual.
 *
 * La prueba es de igualdad de bytes contra el HTML que pintaba el editor ANTES del cambio
 * (`cotizacion-editor-r6.fixture.html`, generado sobre `main` en 9e6ab5d3 con
 * `GENERAR_R6=1`). Una afirmación por texto dejaría pasar un nodo nuevo o uno movido; la
 * igualdad no.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => '/negocios/neg-1/cotizacion/cot-1',
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

const FIXTURE = path.join(__dirname, 'cotizacion-editor-r6.fixture.html')

const rubro = (id: string, valor: number) => ({
  id, tipo: 'materiales', descripcion: `Rubro ${id}`, cantidad: 2, unidad: 'unidades',
  valor_unitario: valor, valor_total: valor * 2, sugerido: false,
})

/** Una cotización de Termotech: rubros, un precio a mano, un margen propio y un cuadre. */
const ITEMS = [
  { id: 'i1', nombre: 'Bomba centrífuga', subtotal: 0, orden: 1, precio_venta: 0, descuento_porcentaje: 0, descripcion: 'Incluye instalación', es_ajuste: false, cantidad: 2, margen_porcentaje: null, precio_manual: false, grupo: null, rubros: [rubro('r1', 100_000), rubro('r2', 50_000)] },
  { id: 'i2', nombre: 'Ingeniería', subtotal: 800_000, orden: 2, precio_venta: 0, descuento_porcentaje: 10, descripcion: null, es_ajuste: false, cantidad: 1, margen_porcentaje: 30, precio_manual: false, grupo: null, rubros: [] },
  { id: 'i3', nombre: 'Transporte', subtotal: 0, orden: 3, precio_venta: 120_000, descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1, margen_porcentaje: null, precio_manual: true, grupo: null, rubros: [] },
  { id: 'i4', nombre: 'Ajuste', subtotal: 0, orden: 4, precio_venta: -1_000, descuento_porcentaje: 0, descripcion: null, es_ajuste: true, cantidad: 1, margen_porcentaje: null, precio_manual: true, grupo: null, rubros: [] },
]

function pintar(estado: string) {
  return renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: {
        id: 'cot-1', codigo: 'COT-2026-0100', consecutivo: 'COT-2026-0100', modo: 'detallada',
        estado, descripcion: 'Obra planta', valor_total: 0, margen_porcentaje: 20,
        costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 5,
        terminos_condiciones: 'Validez 15 días.',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: ITEMS as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      lineaId: 'linea-1',
    }),
  )
}

describe('R6 · el editor de un workspace que no es Trappvel no cambia', () => {
  it('en borrador y enviada, byte a byte igual que antes del rediseño', () => {
    const html = `${pintar('borrador')}\n<!-- enviada -->\n${pintar('enviada')}\n`
    if (process.env.GENERAR_R6 === '1') writeFileSync(FIXTURE, html)
    expect(html).toBe(readFileSync(FIXTURE, 'utf8'))
  })

  it('y no trae nada del flujo de Trappvel: ni pasos, ni bandeja, ni bloques por tipo', () => {
    const html = pintar('borrador')
    for (const t of ['Revisar y enviar', 'Pasos de la cotización', 'Pega o arrastra', '+ Opción', 'data-tipo-bloque']) {
      expect(html).not.toContain(t)
    }
  })
})
