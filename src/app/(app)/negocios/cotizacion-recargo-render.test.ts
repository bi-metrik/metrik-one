/**
 * Regla 2 · el recargo fijo, visto en la pantalla donde la comercial trabaja.
 *
 * ⚠️ Una prueba pura del helper no fija que el JSX obedezca: `estadoDelRecargo` puede
 * devolver «falta» y el editor no pintar el botón. Es el mismo precedente del margen
 * por línea, donde la cascada calculaba bien y la pantalla no mostraba nada.
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
  aplicarRecargo: async () => ({ success: true, valor: 100_000, etiqueta: 'Recargo de emisión' }),
  getPoliticaRecargo: async () => ({ activo: false, etiqueta: '', valor: 0, aplicaA: [] }),
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

const cotizacion = {
  id: 'cot-1',
  codigo: 'COT-2026-0001',
  consecutivo: 'COT-2026-0001',
  modo: 'detallada',
  estado: 'borrador',
  descripcion: 'Punta Cana, 5 días',
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    nombre: 'Vuelo BOG-PUJ',
    grupo: 'vuelo',
    subtotal: 2_000_000,
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

const POLITICA = {
  activo: true,
  etiqueta: 'Recargo de emisión',
  valor: 100_000,
  aplicaA: ['vuelo_detalle'],
}

const pintar = (items: unknown[], politicaRecargo: unknown = POLITICA) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: items as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      politicaRecargo: politicaRecargo as any,
    }),
  )

const lineaRecargo = (valor: number) =>
  item({ nombre: 'Recargo de emisión', grupo: null, subtotal: 0, precio_venta: valor, precio_manual: true, orden: 9 })

describe('el recargo se OFRECE donde corresponde', () => {
  it('con un vuelo y sin el recargo, aparece el botón con su valor', () => {
    const html = pintar([item()])
    expect(html).toContain('Agregar recargo')
    expect(html).toContain('Recargo de emisión')
    expect(html).toContain('100.000')
  })

  it('CONTROL · sin vuelo no se ofrece nada', () => {
    // Sin este control, un banner pintado siempre pasaría la prueba de arriba.
    const html = pintar([item({ grupo: 'hotel', nombre: 'Hotel Occidental' })])
    expect(html).not.toContain('Agregar recargo')
  })

  it('con la línea APAGADA no se ofrece, aunque haya vuelo', () => {
    const html = pintar([item()], { activo: false, etiqueta: 'Recargo de emisión', valor: 0, aplicaA: [] })
    expect(html).not.toContain('Agregar recargo')
  })

  it('ya puesto por el valor vigente, no se ofrece ni se avisa nada', () => {
    const html = pintar([item(), lineaRecargo(100_000)])
    expect(html).not.toContain('Agregar recargo')
    expect(html).not.toContain('vigente de la línea')
  })
})

describe('se ve que la línea lleva OTRO valor', () => {
  it('dice el de la cotización y el vigente, los dos', () => {
    const html = pintar([item(), lineaRecargo(150_000)])
    expect(html).toContain('vigente de la línea')
    expect(html).toContain('150.000')
    expect(html).toContain('100.000')
    // ⚠️ No se dice «editado a mano»: el mismo estado sale cuando alguien sube el
    // vigente sin tocar la cotización, y acusar ahí sería falso.
    expect(html).not.toContain('editado a mano')
  })

  it('y NO vuelve a ofrecer el botón: la línea ya está', () => {
    const html = pintar([item(), lineaRecargo(150_000)])
    expect(html).not.toContain('Agregar recargo')
  })
})

describe('solo para vuelos internacionales', () => {
  const INTERNACIONALES = { ...POLITICA, vuelos: 'internacionales' }
  const vuelo = (origen: string, destino: string) =>
    item({
      nombre: `Vuelo ${origen} - ${destino}`,
      tarifa_pax: {
        casillas: {
          grupo_completo: {
            moneda: 'COP',
            total: 1,
            campos: [{ label: 'Origen', valor: origen }, { label: 'Destino', valor: destino }],
          },
        },
      },
    })

  it('Bogotá – San Andrés: no se ofrece', () => {
    const html = pintar([vuelo('Bogotá BOG', 'San Andrés Isla ADZ')], INTERNACIONALES)
    expect(html).not.toContain('Agregar recargo')
  })

  it('Bogotá – Cancún: se ofrece y dice que es por el vuelo internacional', () => {
    const html = pintar([vuelo('Bogotá BOG', 'Cancún CUN')], INTERNACIONALES)
    expect(html).toContain('Agregar recargo')
    expect(html).toContain('lleva un vuelo internacional')
    expect(html).not.toContain('sin poder confirmarlo')
  })

  it('un destino que no se reconoce: se ofrece, y avisa cuál mirar', () => {
    const html = pintar([vuelo('Bogotá BOG', 'BOQ')], INTERNACIONALES)
    expect(html).toContain('Agregar recargo')
    expect(html).toContain('sin poder confirmarlo')
    expect(html).toContain('BOQ')
  })

  it('CONTROL · con «todos», el Bogotá – San Andrés sí lo ofrece y sin aviso', () => {
    const html = pintar([vuelo('Bogotá BOG', 'San Andrés Isla ADZ')])
    expect(html).toContain('Agregar recargo')
    expect(html).not.toContain('sin poder confirmarlo')
  })
})
