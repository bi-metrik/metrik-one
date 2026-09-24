/**
 * La cotización de viaje dibujada por ranuras, y la zona única de pegado (Parte B y pasos 1
 * y 2 del flujo de Noor, brief de captura del 2026-09-23).
 *
 * Lo que se fija:
 *  1. En Trappvel (`lineasPorTipo`) las opciones de una ranura van dentro de SU bloque, con el
 *     nombre de la ranura como encabezado y el botón «Agregar otra opción de hotel».
 *  2. Fuera del flujo de viaje (Termotech, Arca, WMC) la pantalla no cambia un nodo: ni
 *     bloques ni zona de pegado (R6).
 *  3. La zona de pegado existe una sola vez y acepta «Subir foto» (celular).
 *  4. Una opción con nombre de relleno dice que le falta el pantallazo.
 *
 * ⚠️ Render y no prueba pura: el agrupamiento (`bloquesPorRanura`) puede estar bien y el JSX
 * seguir pintando la lista plana. Se queda en `.ts` por el `include` de vitest.
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
  id: 'cot-1', codigo: 'COT-2026-0010', consecutivo: 'COT-2026-0010', modo: 'detallada',
  estado: 'borrador', descripcion: 'Cancún 6D', valor_total: 0, margen_porcentaje: 15,
  costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
  descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null, margen_default_pct: 15,
  terminos_condiciones: null, convencion_margen: 'sobre_venta',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: 'item-1', nombre: 'LINEA', subtotal: 1_000_000, orden: 1,
    precio_venta: 0, descuento_porcentaje: 0, descripcion: null, es_ajuste: false,
    cantidad: 1, margen_porcentaje: null, precio_manual: false, rubros: [], grupo: null,
    opcion_de: null, unidad: null, ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const HOTEL = 'hotel: Hotel en Cancún'
const LINEAS = [
  item({ id: 'crown', nombre: 'CROWN PARADISE', grupo: HOTEL, orden: 1 }),
  item({ id: 'seguro', nombre: 'SEGURO DE VIAJE', grupo: null, orden: 2 }),
  item({ id: 'hyatt', nombre: 'HYATT ZIVA', grupo: HOTEL, orden: 3 }),
  item({ id: 'op3', nombre: 'OPCIÓN 3', grupo: HOTEL, orden: 4, subtotal: 0 }),
]

const pintar = (lineasPorTipo: boolean, items = LINEAS) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: items as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      lineasPorTipo,
      destinoViaje: 'Cancún',
    }),
  )

/** El trozo del HTML que va dentro del bloque de una ranura. */
function bloque(html: string, etiqueta: string): string {
  const inicio = html.indexOf(`aria-label="Ranura ${etiqueta}"`)
  if (inicio < 0) return ''
  const fin = html.indexOf('</section>', inicio)
  return html.slice(inicio, fin)
}

describe('Trappvel · la cotización se dibuja por ranuras', () => {
  it('las tres opciones del hotel van dentro de SU bloque; el seguro, fuera', () => {
    const dentro = bloque(pintar(true), 'Hotel en Cancún')
    expect(dentro).not.toBe('')
    expect(dentro).toContain('CROWN PARADISE')
    expect(dentro).toContain('HYATT ZIVA')
    expect(dentro).toContain('OPCIÓN 3')
    expect(dentro).not.toContain('SEGURO DE VIAJE')
    expect(dentro).toContain('3 opciones. En cada tarifa entra una sola.')
  })

  it('el bloque ofrece otra opción del mismo tipo, y dice que un segundo tramo no es una opción', () => {
    const dentro = bloque(pintar(true), 'Hotel en Cancún')
    expect(dentro).toContain('Agregar otra opción de hotel')
    expect(dentro).toContain('Un tramo adicional del mismo viaje no es una opción')
  })

  it('el nombre de la ranura se edita en el encabezado del bloque', () => {
    expect(pintar(true)).toMatch(/aria-label="Nombre de la ranura Hotel en Cancún"[^>]*value="Hotel en Cancún"/)
  })

  it('una opción con nombre de relleno dice que le falta el pantallazo', () => {
    expect(bloque(pintar(true), 'Hotel en Cancún')).toContain('pega el pantallazo')
  })

  it('UNA bandeja de pantallazos para la cotización (P7), con «Subir foto» dentro de la zona de pegado', () => {
    const html = pintar(true)
    expect(html.match(/data-bandeja-capturas/g)).toHaveLength(1)
    expect(html).toContain('Pega aquí tus pantallazos con Ctrl+V o arrástralos')
    expect(html).toContain('Subir foto')
    expect(html).toMatch(/<input[^>]*type="file"[^>]*multiple/)
    expect(html).toContain('O agrégalo sin pantallazo')
  })
})

describe('R6 · fuera del flujo de viaje la pantalla no cambia', () => {
  it('sin bloques de ranura ni zona de pegado', () => {
    const html = pintar(false)
    expect(html).not.toContain('aria-label="Ranura ')
    expect(html).not.toContain('data-bandeja-capturas')
    expect(html).not.toContain('O agrégalo sin pantallazo')
    // Las líneas siguen ahí, en su orden.
    const pos = ['CROWN PARADISE', 'SEGURO DE VIAJE', 'HYATT ZIVA'].map(n => html.indexOf(n))
    expect(pos.every(p => p >= 0)).toBe(true)
    expect([...pos].sort((a, b) => a - b)).toEqual(pos)
  })

  it('una línea con un grupo libre no se envuelve en un bloque ni en Trappvel', () => {
    const html = pintar(true, [item({ id: 'x', nombre: 'AVIANCA BOG - ADZ', grupo: 'avianca bog - adz' })])
    expect(html).toContain('AVIANCA BOG - ADZ')
    expect(html).not.toContain('aria-label="Ranura ')
  })
})
