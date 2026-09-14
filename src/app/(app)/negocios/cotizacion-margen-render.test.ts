/**
 * El margen se VE mientras se arma la cotización: por línea y consolidado.
 *
 * ⚠️ Por qué hace falta una prueba de RENDER y no basta con `calcularCascada`: la
 * cascada puede devolver el margen perfecto y el JSX seguir sin pintarlo. Ese era
 * exactamente el defecto — `margenRealPct` existía y la pantalla solo lo mostraba en
 * las líneas con `margen_porcentaje` propio distinto de 0, así que un viaje armado
 * sin una sola excepción (el caso normal) no enseñaba **ningún** margen. Una prueba
 * pura no lo habría visto. Mismo precedente que `negocios-chips-cierre-render.test.ts`.
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ Mutaciones MEDIDAS sobre este archivo (aplicadas y revertidas):
 *   · el chip de margen del encabezado se condiciona a `lineaDecideSuPrecio`
 *     (el comportamiento anterior) ................................. 3 rojas
 *   · `claseNivelMargen` devuelve siempre '' ....................... 2 rojas
 *   · `umbrales` se ignora y se usa UMBRALES_MARGEN_POR_DEFECTO ..... 1 roja
 *   · `origenDelMargen` devuelve siempre 'heredado' ................ 1 roja
 *
 * Los ítems van SIN expandir (`expandedItems` arranca con todos abiertos, así que el
 * render trae las dos superficies: el encabezado y el bloque de precio).
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// El editor arrastra todas las server actions de la cotización y el panel del rastro,
// que consulta al montarse. Nada de eso participa en lo que aquí se prueba.
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

const { default: CotizacionEditor } = await import('./cotizacion-editor')

/** Cotización en borrador, convención `sobre_venta` y margen general del 15%. */
const cotizacion = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cot-1',
    codigo: 'COT-2026-0001',
    consecutivo: 'COT-2026-0001',
    modo: 'detallada',
    estado: 'borrador',
    descripcion: 'España, 7 días',
    valor_total: 0,
    margen_porcentaje: 15,
    costo_total: 0,
    fecha_envio: null,
    fecha_validez: null,
    descuento_porcentaje: 0,
    descuento_valor: 0,
    aiu_admin_pct: null,
    aiu_imprevistos_pct: null,
    margen_default_pct: 15,
    terminos_condiciones: null,
    convencion_margen: 'sobre_venta',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

/** Ítem de costo directo, sin rubros. El caso normal de un viaje a medida. */
const item = (over: Record<string, unknown> = {}) =>
  ({
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    nombre: 'Vuelo BOG-MAD',
    subtotal: 1_000_000,
    orden: 1,
    precio_venta: 0,
    descuento_porcentaje: 0,
    descripcion: null,
    es_ajuste: false,
    cantidad: 1,
    margen_porcentaje: null,
    precio_manual: false,
    rubros: [],
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const pintar = (
  items: unknown[],
  over: Record<string, unknown> = {},
  umbrales = { pisoPct: 5, avisoPct: 10 },
) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: cotizacion(over),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: items as any,
      umbrales,
    }),
  )

/**
 * El color del chip de margen DE LA LÍNEA, no el del consolidado.
 *
 * ⚠️ Buscar `text-red-600` suelto en el HTML NO sirve: el pie de la cotización tiene
 * su propio rojo, así que la afirmación pasaba aunque la línea no se pintara. Se vio
 * con una mutación que dejaba `claseNivelMargen` devolviendo cadena vacía: las 15
 * pruebas seguían en verde.
 */
function colorDeLinea(html: string, pct: string): string | null {
  const m = html.match(new RegExp(`class="([^"]*)"[^>]*>Margen ${pct.replace(',', ',')}<`))
  if (!m) return null
  return (m[1].match(/text-(red|amber|muted-foreground|green)-?\d*/) ?? [null])[0]
}

describe('editor de cotización · margen por línea', () => {
  it('una línea que HEREDA el margen lo muestra igual', () => {
    // El caso que no se veía: sin excepción propia no aparecía ninguna cifra.
    const html = pintar([item()])
    expect(html).toContain('Margen 15,0%')
    expect(html).toContain('Margen real 15,0%')
  })

  it('dice que lo hereda, para que el porcentaje no se lea como excepción', () => {
    const html = pintar([item()])
    expect(html).toContain('hereda el margen de la cotización')
  })

  it('una línea con margen propio del 0% NO se confunde con una que hereda', () => {
    // `null` y `0` son la trampa: los dos pintarían "0,0%" sin el origen al lado, y
    // uno de los dos casos es un viaje entregado al costo.
    const html = pintar([item({ margen_porcentaje: 0 })])
    expect(html).toContain('Margen 0,0%')
    expect(html).toContain('margen propio de la línea')
    expect(html).not.toContain('hereda el margen de la cotización')
  })

  it('una línea con precio escrito a mano deriva su margen del precio', () => {
    const html = pintar([item({ precio_venta: 1_050_000, precio_manual: true })])
    expect(html).toContain('precio escrito a mano')
    // (1.050.000 − 1.000.000) / 1.050.000 = 4,76%
    expect(html).toContain('Margen 4,8%')
  })

  it('bajo el piso sale en ROJO, no en ámbar', () => {
    // El 3,1% con el que Trappvel cerró viajes reales.
    const html = pintar([item({ precio_venta: 1_032_000, precio_manual: true })])
    expect(html).toContain('Margen 3,1%')
    expect(colorDeLinea(html, '3,1%')).toBe('text-red-600')
    expect(html).toContain('bajo el piso de 5,0%')
  })

  it('entre el piso y el aviso sale en ÁMBAR', () => {
    const html = pintar([item({ margen_porcentaje: 8 })])
    expect(colorDeLinea(html, '8,0%')).toBe('text-amber-600')
    expect(html).toContain('bajo el aviso de 10,0%')
  })

  it('los umbrales que manda el servidor son los que deciden el color', () => {
    // Con piso 12, el mismo 8% que arriba era ámbar pasa a rojo. Si la pantalla
    // usara los del producto (5/10) en vez del prop, este caso seguiría en ámbar.
    const html = pintar([item({ margen_porcentaje: 8 })], {}, { pisoPct: 12, avisoPct: 20 })
    expect(colorDeLinea(html, '8,0%')).toBe('text-red-600')
    expect(html).toContain('bajo el piso de 12,0%')
  })

  it('una línea sin costo no muestra margen: no hay con qué medirla', () => {
    const html = pintar([item({ subtotal: 0 })])
    expect(html).not.toContain('Margen 0,0%')
    expect(html).not.toContain('Margen real')
  })

  it('con descuento comercial avisa que el margen de la línea va antes de ese descuento', () => {
    const html = pintar([item()], { descuento_porcentaje: 10 })
    expect(html).toContain('Antes del descuento comercial de 10%')
  })
})

describe('editor de cotización · margen consolidado del viaje', () => {
  it('se ve SIEMPRE, también cuando la cotización está sana', () => {
    // Antes solo aparecía si difería del margen general o si era bajo: la cifra que
    // hay que conocer antes de enviar solo se veía cuando ya era mala.
    const html = pintar([item()])
    expect(html).toContain('Margen del viaje')
    expect(html).toContain('text-green-600')
  })

  it('con líneas que marginan distinto se llama «Margen real» y no coincide con el general', () => {
    const html = pintar([item({ margen_porcentaje: 30 }), item({ nombre: 'Hotel' })])
    expect(html).toContain('Margen real del viaje')
  })

  it('un viaje entero bajo el piso lo marca el consolidado, no solo las líneas', () => {
    const html = pintar([item({ margen_porcentaje: 3 })])
    expect(html).toContain('bajo el piso')
  })

  it('el precio consolidado es el de la convención: 1.176.471, no 1.150.000', () => {
    // El control de la convención congelada. Con `markup` el mismo 15 daría
    // 1.150.000 y el margen real bajaría a 13,0%.
    const html = pintar([item()])
    expect(html).toContain('1.176.471')
    expect(html).not.toContain('1.150.000')
  })

  it('con la convención vieja el precio cambia: es el control que hace válida la prueba anterior', () => {
    const html = pintar([item()], { convencion_margen: 'markup' })
    expect(html).toContain('1.150.000')
    expect(html).toContain('Margen real del viaje')
    expect(html).toContain('13,0%')
  })
})

describe('editor de cotización · rastro de margen', () => {
  it('el historial es alcanzable desde la cotización', () => {
    expect(pintar([item()])).toContain('Historial de cambios de margen')
  })
})
