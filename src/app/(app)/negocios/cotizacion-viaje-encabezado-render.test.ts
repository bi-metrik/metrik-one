/**
 * P9 del caso Providencia (Mauricio, 2026-09-23): «Viaje» deja de ser paso y es el
 * encabezado fijo de la cotización, sin acordeón y con «Cambiar en el negocio». En ámbar si al
 * negocio le faltan fechas o pasajeros. Se queda en `.ts` por el `include` de vitest.
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
vi.mock('@/app/(app)/negocios/pantallazo-actions', () => ({
  leerPantallazoDeItem: async () => ({ ok: false, codigo: 'RX1', motivo: '', instruccion: '' }),
  confirmarLecturaDePantallazo: async () => ({ success: true }),
  descartarPropuestaDePantallazo: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  leerCasillaDeItem: async () => ({ ok: true, mensaje: '', alertas: [] }),
  quitarCasillaDeItem: async () => ({ success: true }),
  confirmarMenorNoPaga: async () => ({ success: true }),
  actualizarComposicionDeItem: async () => ({ success: true }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/recargo-actions', () => ({ aplicarRecargo: async () => ({ success: true }) }))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({
  crearRanuraConOpcion: async () => ({ success: true, itemId: 'x', grupo: 'hotel' }),
  agregarOpcionARanura: async () => ({ success: true, itemId: 'x', grupo: 'hotel' }),
  detectarCaptura: async () => ({ ok: false, codigo: 'SIN_TIPO', mensaje: '' }),
  eliminarRanura: async () => ({ success: true, borradas: 0, desmarcadas: [] }),
}))
vi.mock('@/app/(app)/negocios/itinerario-actions', () => ({
  agregarOpcionAItem: async () => ({ success: true }),
  actualizarRanuraDeItem: async () => ({ success: true }),
  actualizarDiaDeItem: async () => ({ success: true }),
  generarCombinaciones: async () => ({ success: true, creadas: 0, yaExistian: 0, aviso: null }),
  armarTarifas: async () => ({ success: true, creadas: 0, yaExistian: 3, marcadas: [], sinMarcar: [] }),
  cambiarOpcionDeItinerario: async () => ({ success: true, desmarcados: [] }),
  marcarEnPropuesta: async () => ({ success: true }),
  marcarPrincipal: async () => ({ success: true }),
  renombrarItinerario: async () => ({ success: true }),
  renombrarRanura: async () => ({ success: true }),
  eliminarItinerario: async () => ({ success: true }),
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

const cotizacion = {
  id: 'cot-1', codigo: 'COT-2026-0011', consecutivo: 'COT-2026-0011', modo: 'detallada',
  estado: 'borrador', descripcion: 'Providencia', valor_total: 0, margen_porcentaje: 15,
  costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
  descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null, margen_default_pct: 15,
  terminos_condiciones: null, convencion_margen: 'sobre_venta',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const pintar = (lineasPorTipo: boolean, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion,
      initialItems: [],
      umbrales: { pisoPct: 5, avisoPct: 10 },
      lineasPorTipo,
      destinoViaje: 'Providencia',
      fechasViaje: { inicio: '2026-11-09', fin: '2026-11-13' },
      composicionViaje: { adultos: 2, ninos: 0, infantes: 1 },
      ...extra,
    }),
  )

function encabezado(html: string): string {
  const i = html.indexOf('data-encabezado-viaje')
  if (i < 0) return ''
  return html.slice(html.lastIndexOf('<div', i), html.indexOf('Cambiar en el negocio', i))
}

describe('P9 · el viaje es el encabezado fijo, no un paso', () => {
  it('el encabezado dice el viaje y ofrece «Cambiar en el negocio»; el paso «Viaje» ya no está', () => {
    const html = pintar(true)
    expect(encabezado(html)).toContain('Providencia · 9 al 13 nov 2026 · 2 adultos, 1 infante')
    expect(html).toContain('Cambiar en el negocio')
    expect(html).not.toMatch(/>Viaje</)
    expect(html).toContain('Componentes')
  })

  it('sin pasajeros: el encabezado va en ámbar con el motivo', () => {
    const e = encabezado(pintar(true, { composicionViaje: null }))
    expect(e).toContain('bg-amber-50')
    expect(e).toContain('Faltan los pasajeros en el negocio')
  })

  it('completo: sin ámbar', () => {
    expect(encabezado(pintar(true))).not.toContain('bg-amber-50')
  })

  it('R6 · fuera del flujo de viaje no hay encabezado de viaje', () => {
    expect(pintar(false)).not.toContain('data-encabezado-viaje')
  })
})
