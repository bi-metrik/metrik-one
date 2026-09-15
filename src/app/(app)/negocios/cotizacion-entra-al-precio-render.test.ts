/**
 * El segundo interruptor visto en el editor: el aviso rojo, el total del pie y el
 * check «Entra al precio».
 *
 * Una prueba pura de `avisoSugeridosQueCobran` no fija que el JSX le pase al helper el
 * juego de ids que ya saca la sugerencia fuera del precio: el editor arma su propio
 * mapa de líneas (`itemsParaRanuras`) y si olvida el interruptor, la pantalla suma lo
 * que el servidor ya no suma y el aviso sale rojo sobre una sugerencia declarada.
 *
 * Se queda en `.ts`: el `include` de `vitest.config.ts` es `src/**\/*.test.ts`.
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
vi.mock('@/app/(app)/negocios/recargo-actions', () => ({
  aplicarRecargo: async () => ({ success: true, valor: 0, etiqueta: '' }),
  getPoliticaRecargo: async () => ({ activo: false, etiqueta: '', valor: 0, aplicaA: [] }),
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

const cotizacion = {
  id: 'cot-1',
  codigo: 'COT-2026-0007',
  consecutivo: 'COT-2026-0007',
  modo: 'detallada',
  estado: 'borrador',
  descripcion: 'Punta Cana, 5 días',
  valor_total: 0,
  margen_porcentaje: 13,
  costo_total: 0,
  fecha_envio: null,
  fecha_validez: null,
  descuento_porcentaje: 0,
  descuento_valor: 0,
  aiu_admin_pct: null,
  aiu_imprevistos_pct: null,
  margen_default_pct: 13,
  terminos_condiciones: null,
  convencion_margen: 'sobre_venta',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

let n = 0
const item = (over: Record<string, unknown> = {}) =>
  ({
    id: `item-${++n}`,
    nombre: 'Línea',
    grupo: null,
    subtotal: 0,
    orden: n,
    precio_venta: 0,
    descuento_porcentaje: 0,
    descripcion: null,
    es_ajuste: false,
    cantidad: 1,
    margen_porcentaje: null,
    precio_manual: false,
    dia_relativo: null,
    mostrar_en_sugeridos: true,
    rubros: [],
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const pintar = (items: unknown[]) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: items as any,
    }),
  )

/** El viaje del escenario: vuelo, hotel, traslado y dos tours. */
const vuelo = () => item({ id: 'avianca', nombre: 'Vuelos - Avianca', grupo: 'vuelo', subtotal: 2_000_000, precio_venta: 2_298_851 })
const hotel = () => item({ id: 'hotel', nombre: 'Hotel Occidental', grupo: 'hotel', subtotal: 1_350_000, precio_venta: 1_551_724 })
const traslado = (over = {}) => item({ id: 'traslado', nombre: 'Traslado aeropuerto', grupo: 'traslado', subtotal: 200_000, precio_venta: 229_885, ...over })
const saona = (over = {}) => item({ id: 'saona', nombre: 'Tour Isla Saona', grupo: 'tour', subtotal: 540_000, precio_venta: 620_690, ...over })

const catalina = (over = {}) =>
  item({ id: 'catalina', nombre: 'Tour Isla Catalina', grupo: 'excursion', subtotal: 480_000, precio_venta: 551_724, ...over })

describe('(a) y (b) · el aviso rojo, en la pantalla donde la comercial mira', () => {
  it('(a) una sugerencia con precio FUERA del precio no dispara el aviso', () => {
    const html = pintar([
      vuelo(),
      hotel(),
      traslado({ dia_relativo: 1 }),
      saona({ dia_relativo: 1 }),
      catalina({ entra_al_precio: false }),
    ])
    expect(html).not.toContain('se va a imprimir como')
    expect(html).not.toContain('se van a imprimir como')
    // Y se ve que no suma, sin abrir la línea.
    expect(html).toContain('Sugerida · fuera del precio')
    expect(html).toContain('No suma al total')
  })

  it('(b) la misma, entrando al precio, SÍ dispara el aviso con su plata', () => {
    const html = pintar([
      vuelo(),
      hotel(),
      traslado({ dia_relativo: 1 }),
      saona({ dia_relativo: 1 }),
      catalina({ entra_al_precio: true }),
    ])
    expect(html).toContain('se va a imprimir como')
    expect(html).toContain('Tour Isla Catalina')
    expect(html).toContain('551.724')
    // La salida nueva, dicha con todas las letras.
    expect(html).toContain('desmarca «Entra al precio»')
    expect(html).not.toContain('No suma al total')
  })

  it('⚠️ el total del pie NO incluye la sugerencia fuera del precio', () => {
    // El pie sale de la misma cascada que guarda el servidor. Con la línea fuera, el
    // total baja exactamente lo que ella cobra: 5.252.874 - 551.724 = 4.701.150.
    const dentro = pintar([vuelo(), hotel(), traslado(), saona(), catalina()])
    const fuera = pintar([vuelo(), hotel(), traslado(), saona(), catalina({ entra_al_precio: false })])
    expect(dentro).toContain('5.252.874')
    expect(fuera).toContain('4.701.150')
    expect(fuera).not.toContain('5.252.874')
  })
})

describe('el interruptor en la ficha de la línea', () => {
  it('se ofrece en una sugerencia (tour sin día), aunque la cotización no use días', () => {
    const html = pintar([vuelo(), catalina()])
    expect(html).toContain('Entra al precio de la cotización')
  })

  it('⚠️ un vuelo NO lo ofrece: el servidor lo rechazaría', () => {
    const html = pintar([vuelo()])
    expect(html).not.toContain('Entra al precio de la cotización')
  })

  it('⚠️ una línea sin grupo NO lo ofrece', () => {
    const html = pintar([item({ id: 'seguro', nombre: 'Seguro de viaje', grupo: null, subtotal: 90_000 })])
    expect(html).not.toContain('Entra al precio de la cotización')
  })

  it('⚠️ un tour CON día NO lo ofrece: con día está incluido', () => {
    const html = pintar([saona({ dia_relativo: 2 })])
    expect(html).not.toContain('Entra al precio de la cotización')
  })

  it('fuera del precio, el campo del día queda deshabilitado y lo dice', () => {
    const html = pintar([catalina({ entra_al_precio: false })])
    expect(html).toContain('márcala para que entre al precio antes de darle un día')
    expect(html).toMatch(/aria-label="Día del viaje"[^>]*disabled/)
  })

  it('fuera del precio, el check de mostrar ya no advierte que sigue cobrando', () => {
    const html = pintar([catalina({ entra_al_precio: false })])
    expect(html).toContain('Mostrarla al cliente entre las actividades sugeridas')
    expect(html).toContain('ni se ve ni se cobra')
    expect(html).not.toContain('Ocultarla NO la saca del total')
  })
})
