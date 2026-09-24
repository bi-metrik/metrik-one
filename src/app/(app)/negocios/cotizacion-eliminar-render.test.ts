/**
 * P12 y P13 del caso Providencia (2026-09-23), en la pantalla.
 *
 *  · P12: cada opción de un bloque se borra desde su fila (sin abrirla) y el bloque entero
 *    desde el menú ⋯ de su encabezado. Nada de eso aparece fuera del flujo de viaje (R6) ni
 *    en una cotización que ya no se edita.
 *  · P13: «Descargar PDF» a la izquierda y «Enviar» a la derecha; en el celular Enviar
 *    arriba y a todo el ancho.
 *
 * El borrado diferido y su «Deshacer» no se pueden afirmar sin DOM (nacen de un clic); aquí se
 * fija que los controles estén donde tienen que estar. Se queda en `.ts` por el `include`.
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
const { default: BotonesRevisar } = await import('./botones-revisar')

const cotizacion = {
  id: 'cot-1', codigo: 'COT-2026-0011', consecutivo: 'COT-2026-0011', modo: 'detallada',
  estado: 'borrador', descripcion: 'Providencia', valor_total: 0, margen_porcentaje: 15,
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

const VUELO3 = 'vuelo 3: Vuelo a Providencia'
const LINEAS = [
  item({ id: 'op1', nombre: 'OPCIÓN 1', grupo: VUELO3, orden: 1, subtotal: 0 }),
  item({ id: 'op2', nombre: 'OPCIÓN 2', grupo: VUELO3, orden: 2, subtotal: 0 }),
  item({ id: 'seguro', nombre: 'SEGURO DE VIAJE', grupo: null, orden: 3 }),
]

const pintar = (lineasPorTipo: boolean, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: LINEAS as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      lineasPorTipo,
      destinoViaje: 'Providencia',
      ...extra,
    }),
  )

/**
 * El HTML del bloque de esa ranura, hasta SU `</section>`: la tarjeta de cada opción trae
 * secciones propias («Alojamiento», «Costo y precio»), así que se cuentan las anidadas.
 */
function bloque(html: string, etiqueta: string): string {
  const marca = html.indexOf(`aria-label="Ranura ${etiqueta}"`)
  if (marca < 0) return ''
  const inicio = html.lastIndexOf('<section', marca)
  const tags = /<section\b|<\/section>/g
  tags.lastIndex = inicio
  let profundidad = 0
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    profundidad += m[0] === '</section>' ? -1 : 1
    if (profundidad === 0) return html.slice(inicio, m.index)
  }
  return html.slice(inicio)
}

describe('P12 · eliminar una opción y un bloque (Trappvel)', () => {
  it('cada opción del bloque se elimina desde el menú ⋯ de su tarjeta, sin abrirla', () => {
    // Prototipo de la tarjeta (2026-09-24): «Eliminar opción» vive en el ⋯ y se confirma ahí.
    const dentro = bloque(pintar(true), 'Vuelo 3 · Vuelo a Providencia')
    for (const id of ['op1', 'op2']) {
      const desde = dentro.indexOf(`data-tarjeta-opcion="${id}"`)
      expect(desde).toBeGreaterThan(-1)
      expect(dentro.indexOf('aria-label="Más acciones"', desde)).toBeGreaterThan(desde)
    }
    expect(dentro).not.toContain('data-eliminar-opcion')
  })

  it('el encabezado del bloque tiene el menú ⋯ junto a «+ Opción»', () => {
    const dentro = bloque(pintar(true), 'Vuelo 3 · Vuelo a Providencia')
    expect(dentro).toContain('aria-label="Más acciones del bloque Vuelo 3 · Vuelo a Providencia"')
    expect(dentro.indexOf('Agregar otra opción de vuelo')).toBeLessThan(dentro.indexOf('Más acciones del bloque'))
  })

  it('una cotización que ya no se edita no ofrece borrar', () => {
    const html = pintar(true, { frozen: true })
    expect(html).not.toContain('data-eliminar-opcion')
    expect(html).not.toContain('Más acciones del bloque')
  })

  it('R6 · fuera del flujo de viaje no aparece nada nuevo', () => {
    const html = pintar(false)
    expect(html).not.toContain('data-eliminar-opcion')
    expect(html).not.toContain('Más acciones del bloque')
  })
})

describe('P13 · los botones de «Revisar y enviar»', () => {
  const nada = () => {}
  const html = (editable = true) => renderToStaticMarkup(React.createElement(BotonesRevisar, {
    editable, pendiente: false, motivoParaNoEnviar: null, onDescargar: nada, onEnviar: nada,
  }))

  const contenedor = (h: string) => h.slice(0, h.indexOf('>'))
  const etiqueta = (h: string, boton: string) => {
    const i = h.indexOf(`data-boton="${boton}"`)
    return h.slice(h.lastIndexOf('<button', i), h.indexOf('>', i))
  }

  it('Descargar a la izquierda, Enviar a la derecha (fila en escritorio)', () => {
    const h = html()
    expect(h.indexOf('data-boton="descargar"')).toBeLessThan(h.indexOf('data-boton="enviar"'))
    expect(contenedor(h)).toContain('sm:flex-row')
    expect(contenedor(h)).toContain('sm:justify-between')
  })

  it('en el celular Enviar arriba y a todo el ancho, Descargar debajo', () => {
    const h = html()
    expect(contenedor(h)).toContain('flex-col-reverse')
    expect(etiqueta(h, 'enviar')).toMatch(/\bw-full\b/)
    expect(etiqueta(h, 'enviar')).toContain('sm:w-auto')
  })

  it('sin permiso de editar solo queda Descargar', () => {
    const h = html(false)
    expect(h).toContain('Descargar PDF')
    expect(h).not.toContain('data-boton="enviar"')
  })
})
