/**
 * §4.2 y §4.3 en la pantalla: los botones dicen lo que hacen, y el aviso de cobertura
 * aparece antes de imprimir.
 *
 * ⚠️ Por qué RENDER: la regla de qué cubre cada opción es pura y tiene su prueba
 * (`cobertura-opciones.test.ts`), pero que el JSX la obedezca —que el banner exista, que
 * el botón nombre su ranura, que el texto de ayuda esté— no lo mide ninguna prueba pura.
 * Con el helper perfecto y el banner sin pintar, todo seguiría en verde y el PDF seguiría
 * saliendo sin el tramo.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts` y renombrarlo a `.tsx`
 * saca el archivo de la suite EN SILENCIO.
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
vi.mock('@/app/(app)/negocios/recargo-actions', () => ({
  aplicarRecargo: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/itinerario-actions', () => ({
  agregarOpcionAItem: async () => ({ success: true }),
  actualizarRanuraDeItem: async () => ({ success: true }),
  actualizarDiaDeItem: async () => ({ success: true }),
  generarCombinaciones: async () => ({ success: true, creadas: 0, yaExistian: 0, aviso: null }),
  cambiarOpcionDeItinerario: async () => ({ success: true, desmarcados: [] }),
  marcarEnPropuesta: async () => ({ success: true }),
  marcarPrincipal: async () => ({ success: true }),
  renombrarItinerario: async () => ({ success: true }),
  eliminarItinerario: async () => ({ success: true }),
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

const cotizacion = {
  id: 'cot-1', codigo: 'COT-2026-0002', consecutivo: 'COT-2026-0002', modo: 'detallada',
  estado: 'borrador', descripcion: 'San Andrés 5D', valor_total: 0, margen_porcentaje: 15,
  costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
  descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null, margen_default_pct: 15,
  terminos_condiciones: null, convencion_margen: 'sobre_venta',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const lectura = (identidad: Record<string, string | null>) => ({
  moneda: 'COP',
  total: 1_000_000,
  aPagarAgencia: null,
  porTipo: [],
  ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 },
  ocupacionDelItem: false,
  identidad,
  notasCliente: [],
  alertas: [],
  campos: [],
  nombre: 'Línea',
  descripcion: '',
  leidaEn: '2026-09-21T12:00:00Z',
})

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: 'item-1', nombre: 'AVIANCA', subtotal: 1_000_000, orden: 1,
    precio_venta: 0, descuento_porcentaje: 0, descripcion: null, es_ajuste: false,
    cantidad: 1, margen_porcentaje: null, precio_manual: false, rubros: [], grupo: null,
    opcion_de: null, unidad: null, ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

/** El caso de Alejandra: Avianca ida y vuelta, y Satena a Providencia como opción. */
const AVIANCA = item({
  id: 'a',
  nombre: 'AVIANCA',
  grupo: 'vuelo',
  tarifa_pax: {
    casillas: {
      grupo_completo: lectura({
        origen: 'Bogotá', destino: 'San Andrés',
        fecha_salida: '2026-11-10', fecha_regreso: '2026-11-15',
      }),
    },
  },
})
const SATENA = item({
  id: 'b',
  nombre: 'SATENA',
  grupo: 'vuelo',
  opcion_de: 'a',
  orden: 2,
  tarifa_pax: {
    casillas: {
      grupo_completo: lectura({
        origen: 'San Andrés', destino: 'Providencia',
        fecha_salida: '2026-11-11', fecha_regreso: null,
      }),
    },
  },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pintar(items: any[], lineasPorTipo = true) {
  return renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion,
      initialItems: items,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      lineasPorTipo,
      composicionViaje: { adultos: 2, ninos: 0, infantes: 0 },
    }),
  )
}

/** El texto de cada botón, sin el ícono. */
const botones = (html: string) =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim())

/** El HTML sin etiquetas, para buscar frases que la maquetación parte en varios nodos. */
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// ── §4.2 · los botones dicen lo que hacen ────────────────────────────────────

describe('el botón de opción nombra su ranura', () => {
  it('en una línea de vuelo: «Agregar otra opción de vuelo»', () => {
    expect(botones(pintar([AVIANCA]))).toContain('Agregar otra opción de vuelo')
  })

  it('en una línea de hotel: «Agregar otra opción de hotel»', () => {
    expect(botones(pintar([item({ grupo: 'hotel', nombre: 'DECAMERON' })]))).toContain(
      'Agregar otra opción de hotel',
    )
  })

  it('sin ranura, el botón genérico: la palabra «alternativa» ya no aparece', () => {
    const html = pintar([item()], false)
    expect(botones(html)).toContain('Agregar otra opción a esta línea')
    expect(html).not.toContain('Agregar alternativa')
  })

  it('debajo dice qué pasa con el precio y dónde va un tramo de más', () => {
    const t = texto(pintar([AVIANCA]))
    expect(t).toContain('Solo una opción entra al precio final')
    expect(t).toContain('Las demás quedan para comparar')
    // El apaño de la §6, que es la única salida correcta mientras 4.1 no exista.
    expect(t).toContain('Un tramo adicional del mismo viaje no es una opción: va como componente aparte')
  })
})

describe('el botón del componente suelto', () => {
  it('se llama «Otro componente del viaje» y dice que suma siempre', () => {
    const html = pintar([AVIANCA])
    expect(botones(html)).toContain('Otro componente del viaje')
    expect(texto(html)).toContain('Otro componente del viaje suma siempre al precio')
  })

  it('avisa que un segundo «+ Vuelo» es otra opción, no otro vuelo cobrado', () => {
    const t = texto(pintar([AVIANCA]))
    expect(t).toContain('si ya hay una, la nueva es otra opción y solo una entra al precio final')
    expect(t).toContain('Un tramo adicional del mismo viaje va como componente, no como opción')
  })

  it('en una cotización que no es de viaje, esa ayuda no se pinta (R6)', () => {
    const t = texto(pintar([item()], false))
    expect(t).not.toContain('Otro componente del viaje suma siempre al precio')
  })
})

// ── §4.3 · el aviso que le habría salvado el PDF ─────────────────────────────

describe('el aviso de cobertura en el editor', () => {
  it('nombra lo que cubre cada opción cuando no cubren lo mismo', () => {
    const t = texto(pintar([AVIANCA, SATENA]))
    expect(t).toContain('Revisa qué cubre cada opción antes de imprimir')
    expect(t).toContain('«AVIANCA» cubre Bogotá–San Andrés y San Andrés–Bogotá')
    expect(t).toContain('«SATENA» cubre San Andrés–Providencia')
    expect(t).toContain('Solo una entra al precio final')
  })

  it('con dos opciones que cubren lo mismo no se pinta nada', () => {
    const latam = item({
      id: 'b', nombre: 'LATAM', grupo: 'vuelo', opcion_de: 'a', orden: 2,
      tarifa_pax: {
        casillas: {
          grupo_completo: lectura({
            origen: 'Bogotá', destino: 'San Andrés',
            fecha_salida: '2026-11-10', fecha_regreso: '2026-11-15',
          }),
        },
      },
    })
    expect(texto(pintar([AVIANCA, latam]))).not.toContain('Revisa qué cubre cada opción')
  })

  it('con una sola opción cargada tampoco: no hay con qué comparar', () => {
    expect(texto(pintar([AVIANCA]))).not.toContain('Revisa qué cubre cada opción')
  })

  it('cuando de una opción no se leyó el trayecto, dice que no pudo comparar', () => {
    const sinRuta = item({
      id: 'b', nombre: 'SATENA', grupo: 'vuelo', opcion_de: 'a', orden: 2,
      tarifa_pax: { casillas: { grupo_completo: lectura({ origen: null, destino: null }) } },
    })
    const t = texto(pintar([AVIANCA, sinRuta]))
    expect(t).toContain('No se pudo comparar qué cubre cada opción de vuelo')
    expect(t).toContain('«SATENA»')
    expect(t).not.toContain('cubren lo mismo')
  })

  it('en una cotización sin opciones no aparece (R6)', () => {
    expect(texto(pintar([item(), item({ id: 'c', orden: 2 })], false))).not.toContain(
      'Revisa qué cubre cada opción',
    )
  })
})
