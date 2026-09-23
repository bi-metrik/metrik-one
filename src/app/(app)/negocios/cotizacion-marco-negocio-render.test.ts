/**
 * El negocio alrededor de la cotización de viaje (layout del 2026-09-23).
 *
 * Lo que se fija:
 *  1. Con el marco, el editor no repite el encabezado P9 (lo absorbe el marco) y la zona de
 *     pegado es UNA franja fija, hija directa del contenedor del editor y fuera del paso
 *     «Componentes»: así se queda pegada bajo el encabezado en toda la cotización (R3).
 *  2. R6 · fuera del flujo de viaje el marco no cambia un byte del editor.
 *
 * El marco mismo (encabezado y columna del negocio) lo fija `marco-identico-render.test.ts`.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
  useParams: () => ({ id: 'neg-1', cotId: 'cot-1' }),
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
const { MarcoCotizacionContexto } = await import('./marco-cotizacion-contexto')

const cotizacion = {
  id: 'cot-1', codigo: 'COT-2026-0011', consecutivo: 'COT-2026-0011', modo: 'detallada',
  estado: 'borrador', descripcion: 'Providencia', valor_total: 0, margen_porcentaje: 15,
  costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
  descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null, margen_default_pct: 15,
  terminos_condiciones: null, convencion_margen: 'sobre_venta',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const editor = (lineasPorTipo: boolean) =>
  React.createElement(CotizacionEditor, {
    oportunidadId: 'neg-1',
    cotizacion,
    initialItems: [],
    umbrales: { pisoPct: 5, avisoPct: 10 },
    lineasPorTipo,
    destinoViaje: 'Providencia',
    fechasViaje: { inicio: '2026-11-09', fin: '2026-11-13' },
    composicionViaje: { adultos: 2, ninos: 0, infantes: 1 },
  })

const conContexto = (hijo: React.ReactElement) =>
  React.createElement(MarcoCotizacionContexto.Provider, { value: { activo: true } }, hijo)

describe('el editor dentro del marco del negocio', () => {
  it('no repite el encabezado P9 y la zona de pegado es una franja fija fuera del paso «Componentes»', () => {
    const html = renderToStaticMarkup(conContexto(editor(true)))
    expect(html).not.toContain('Cambiar en el negocio')
    expect(html).not.toContain('data-encabezado-viaje')
    expect(html).toContain('data-bandeja-fija')
    expect(html.match(/data-bandeja-capturas/g)?.length).toBe(1)
    expect(html.indexOf('data-bandeja-fija')).toBeLessThan(html.indexOf('Componentes'))
    expect(html).toContain('top:var(--alto-encabezado-negocio, 0px)')
    // En el celular la franja trae el botón: sin botón flotante duplicado.
    expect(html).not.toContain('fixed bottom-20')
  })

  it('sin marco, el viaje sigue como hoy: encabezado P9 y la bandeja dentro del paso', () => {
    const html = renderToStaticMarkup(editor(true))
    expect(html).toContain('Cambiar en el negocio')
    expect(html).not.toContain('data-bandeja-fija')
    expect(html).toContain('data-bandeja-capturas')
  })

  it('R6 · fuera del flujo de viaje el marco no cambia un byte', () => {
    expect(renderToStaticMarkup(conContexto(editor(false)))).toBe(renderToStaticMarkup(editor(false)))
  })
})
