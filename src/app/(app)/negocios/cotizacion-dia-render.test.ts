/**
 * El DÍA y el aviso de dinero, vistos en la pantalla donde la comercial trabaja.
 *
 * ⚠️ Una prueba pura de `avisoSugeridosQueCobran` no fija que el JSX obedezca: el
 * helper puede devolver la línea y el editor no pintar nada. Es el mismo precedente
 * del recargo y del margen por línea, donde el cálculo estaba bien y la pantalla no
 * mostraba el número. Y aquí importa más que en ningún otro sitio, porque el aviso ES
 * el frente: sin él, el documento sale diciendo «no incluida» sobre una línea que el
 * cliente paga, y nadie se entera.
 *
 * ⚠️ Se queda en `.ts`: el `include` de `vitest.config.ts` es `src/**\/*.test.ts` y
 * renombrarlo a `.tsx` saca el archivo de la suite EN SILENCIO.
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

describe('⚠️⚠️ el aviso de dinero se PINTA donde la comercial mira', () => {
  it('nombra la línea, dice cuánto suma y ofrece las dos salidas', () => {
    // Un tour con día (la cotización usa días) y un traslado con precio y sin día.
    const html = pintar([vuelo(), hotel(), traslado(), saona({ dia_relativo: 2 })])

    expect(html).toContain('se va a imprimir como')
    expect(html).toContain('no incluida')
    expect(html).toContain('Traslado aeropuerto')
    expect(html).toContain('229.885')
    // Las dos salidas, dichas con todas las letras.
    expect(html).toContain('asígnale un día')
    expect(html).toContain('déjala en cero')
  })

  it('CONTROL · sin un solo día asignado NO hay aviso, aunque el traslado tenga precio', () => {
    // Sin este control, un aviso pintado siempre pasaría la prueba de arriba. Y es
    // además el criterio 1 del encargo visto desde la pantalla: una cotización que no
    // usa días no tiene sugerencias, así que no hay contradicción que avisar.
    const html = pintar([vuelo(), hotel(), traslado(), saona()])
    expect(html).not.toContain('se va a imprimir como')
    expect(html).not.toContain('se van a imprimir como')
  })

  it('CONTROL · un vuelo sin día NUNCA dispara el aviso', () => {
    // El vuelo cuesta 2.298.851 y no tiene día: si el criterio fuera «no tiene día y
    // cobra», saldría aquí. No sale porque nunca puede ser sugerencia.
    const html = pintar([vuelo(), hotel(), saona({ dia_relativo: 1 })])
    expect(html).not.toContain('se va a imprimir como')
  })

  it('una sugerencia SIN precio no avisa: es una oferta, no una contradicción', () => {
    const html = pintar([vuelo(), hotel(), traslado({ precio_venta: 0, subtotal: 0 }), saona({ dia_relativo: 1 })])
    expect(html).not.toContain('se va a imprimir como')
  })

  it('dos líneas: el aviso las lista y suma la plata de las dos', () => {
    const html = pintar([
      vuelo(),
      traslado(),
      item({ id: 'catalina', nombre: 'Tour Isla Catalina', grupo: 'excursion', subtotal: 480_000, precio_venta: 551_724 }),
      saona({ dia_relativo: 1 }),
    ])
    expect(html).toContain('se van a imprimir como')
    expect(html).toContain('Traslado aeropuerto')
    expect(html).toContain('Tour Isla Catalina')
    // 229.885 + 551.724 = 781.609
    expect(html).toContain('781.609')
  })

  it('⚠️ una sugerencia OCULTA que cobra dice además que el cliente ni la ve', () => {
    const html = pintar([vuelo(), traslado({ mostrar_en_sugeridos: false }), saona({ dia_relativo: 1 })])
    expect(html).toContain('el cliente ni la ve')
  })
})

describe('el campo del día y el check, en la ficha de la línea', () => {
  it('un tour ofrece el campo «Día del viaje»', () => {
    const html = pintar([saona()])
    expect(html).toContain('Día del viaje')
  })

  it('⚠️ un vuelo NO lo ofrece: el servidor lo rechazaría', () => {
    // Ofrecer un campo que el servidor va a rechazar es peor que no ofrecerlo.
    const html = pintar([vuelo()])
    expect(html).not.toContain('Día del viaje')
  })

  it('el check de mostrar solo aparece cuando la línea ES una sugerencia', () => {
    const conDias = pintar([traslado(), saona({ dia_relativo: 1 })])
    expect(conDias).toContain('Mostrarla al cliente entre las actividades sugeridas')
    // Sin días no hay sugerencias, así que el check no tiene sentido y no se pinta.
    const sinDias = pintar([traslado(), saona()])
    expect(sinDias).not.toContain('Mostrarla al cliente entre las actividades sugeridas')
  })

  it('el día y la marca de sugerida se ven SIN abrir la línea', () => {
    const html = pintar([traslado(), saona({ dia_relativo: 3 })])
    expect(html).toContain('Día 3')
    expect(html).toContain('Sugerida')
  })
})
