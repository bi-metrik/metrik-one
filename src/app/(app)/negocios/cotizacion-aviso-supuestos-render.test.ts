/**
 * C2 · el aviso viejo «Tours, traslados y planes no abren columna…» mira la tarifa principal.
 *
 * La forma por pasos escribe en las tarifas la elección de un traslado o una actividad, y la
 * lectura (`itemsDelItinerario`) ya la cobra. El editor de siempre (interruptor apagado) seguía
 * diciendo «cuenta la primera, borra la alternativa» aunque contara la elegida (nota técnica de
 * Max §2). Ahora, si la tarifa principal nombra una opción de ese servicio, no hay supuesto que
 * anunciar.
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
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

const cotizacion = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cot-1', codigo: 'COT-2026-0001', consecutivo: 'COT-2026-0001', modo: 'detallada',
    estado: 'borrador', descripcion: 'Punta Cana 5 días', valor_total: 0, margen_porcentaje: 15,
    costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
    descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null, margen_default_pct: 15,
    terminos_condiciones: null, convencion_margen: 'sobre_venta', ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: 'item-1', nombre: 'Vuelo BOG-PUJ', subtotal: 1_000_000, orden: 1, precio_venta: 0,
    descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
    margen_porcentaje: null, precio_manual: false, rubros: [], grupo: null, opcion_de: null,
    unidad: null, ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const pintar = (items: unknown[], itinerarios: unknown = null) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: cotizacion(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: items as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(itinerarios ? { itinerarios: itinerarios as any } : {}),
    }),
  )

const DOS_TRASLADOS = [
  item({ id: 't1', nombre: 'Van compartida', grupo: 'traslado', orden: 1 }),
  item({ id: 't2', nombre: 'Van privada', grupo: 'traslado', orden: 2 }),
]
const conPrincipal = (seleccion: string[], porTarifa?: { tarifa: string; opcion: string }[]) => ({
  ranuras: [], fijosConAlternativas: [{ grupo: 'traslado', aporta: 'Van compartida', fuera: ['Van privada'], ...(porTarifa ? { porTarifa } : {}) }], umbrales: { pisoPct: 5, avisoPct: 10 }, tablasAusentes: false,
  recomendadaFalta: null, aceptadaId: null, motivoDisponible: true,
  itinerarios: [{ id: 'tf-rec', nombre: 'Recomendada', orden: 1, vaEnPropuesta: true, esPrincipal: true, seleccion, ranurasFaltantes: [], costo: 0, precio: 0, margenRealPct: null, bloqueo: null, motivoCodigo: null, motivoTexto: null }],
})

describe('C2 · el aviso de supuestos del editor de siempre', () => {
  it('la tabla dice cuál cobra cada tarifa cuando una lo escogió, y no «suman igual»', () => {
    const html = pintar(DOS_TRASLADOS, conPrincipal(['t2'], [{ tarifa: 'Recomendada', opcion: 'Van privada' }]))
    expect(html).toContain('cada tarifa cobra la suya')
    expect(html).toContain('Recomendada «Van privada»')
    expect(html).not.toContain('suman igual en las tres')
    expect(pintar(DOS_TRASLADOS, conPrincipal(['t2']))).toContain('suman igual en las tres')
  })

  it('sin tarifa que lo nombre, sigue avisando que el traslado cuenta por supuesto', () => {
    expect(pintar(DOS_TRASLADOS)).toContain('para cambiar cuál suma, borra la alternativa')
  })

  it('con la tarifa principal nombrando el traslado, no hay supuesto que avisar', () => {
    const html = pintar(DOS_TRASLADOS, conPrincipal(['t2']))
    expect(html).not.toContain('para cambiar cuál suma, borra la alternativa')
    expect(html).not.toContain('el total toma una opción por supuesto')
  })

  it('una principal que no nombra el traslado lo sigue avisando', () => {
    expect(pintar(DOS_TRASLADOS, conPrincipal([]))).toContain('para cambiar cuál suma, borra la alternativa')
  })
})
