/**
 * La pasada de limpieza de la pantalla de cotización, y el aviso donde iría la tabla de
 * combinaciones.
 *
 * Todo esto es opt-in por `lineasPorTipo`, que es la misma marca que ya decide si la
 * pantalla ofrece «+ Vuelo / + Hotel» (`lineas-por-tipo.ts`): en Termotech, WMC, Arca y
 * SOENA la pantalla no cambia ni un pixel. Esa es la mitad de lo que estas pruebas
 * verifican — cada caso se mide en las DOS direcciones.
 *
 * ⚠️ Por qué RENDER: lo que se está quitando no tiene helper propio. Un campo que sobra
 * y un botón que abre un panel vacío solo se pueden medir pintando la pantalla; una
 * prueba pura habría seguido en verde con el campo puesto.
 *
 * ⚠️ Se queda en `.ts`, no `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
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

const cotizacion = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cot-1', codigo: 'COT-2026-0002', consecutivo: 'COT-2026-0002', modo: 'detallada',
    estado: 'borrador', descripcion: 'España 7D', valor_total: 0, margen_porcentaje: 15,
    costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
    descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null, margen_default_pct: 15,
    terminos_condiciones: null, convencion_margen: 'sobre_venta', ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

/** Una línea sin grupo: así no se monta la casilla de pantallazo, que no es lo medido. */
const item = (over: Record<string, unknown> = {}) =>
  ({
    id: 'item-1', nombre: 'LATAM BOGOTÁ–ORLANDO', subtotal: 1_000_000, orden: 1,
    precio_venta: 0, descuento_porcentaje: 0, descripcion: null, es_ajuste: false,
    cantidad: 1, margen_porcentaje: null, precio_manual: false, rubros: [], grupo: null,
    opcion_de: null, unidad: null, ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

/** El estado de itinerarios de la cotización de prueba: un vuelo y un hotel, uno de cada. */
const SIN_ALTERNATIVAS = {
  ranuras: [],
  fijosConAlternativas: [],
  itinerarios: [],
  umbrales: { pisoPct: 5, avisoPct: 10 },
  tablasAusentes: false,
}

const pintar = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: cotizacion(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: [item()] as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      ...over,
    }),
  )

describe('la unidad no se teclea en el flujo de viaje', () => {
  it('con líneas por tipo no hay campo «Unidad»', () => {
    const html = pintar({ lineasPorTipo: true })
    expect(html).not.toContain('pax, noches, trayectos')
    expect(html).not.toContain('Se imprime tal cual al cliente')
  })

  it('sin la marca, el campo sigue exactamente donde estaba', () => {
    const html = pintar()
    expect(html).toContain('pax, noches, trayectos')
    expect(html).toContain('Se imprime tal cual al cliente')
  })

  it('lo que NO se quita: nombre, grupo, descripción y alternativa siguen ahí', () => {
    // El campo de al lado se fue; los que sostienen el trabajo se quedan. Sin esto,
    // una limpieza de más pasaría igual de verde.
    const html = pintar({ lineasPorTipo: true })
    expect(html).toContain('aria-label="Nombre de la línea"')
    expect(html).toContain('aria-label="Grupo de la línea"')
    expect(html).toContain('Describe qué incluye este item')
    expect(html).toContain('Agregar alternativa a esta línea')
  })
})

describe('el catálogo de servicios no aplica al flujo de viaje', () => {
  it('con líneas por tipo no se ofrece «Desde catálogo»', () => {
    expect(pintar({ lineasPorTipo: true })).not.toContain('Desde catálogo')
  })

  it('sin la marca, el botón sigue ahí', () => {
    expect(pintar()).toContain('Desde catálogo')
  })
})

describe('administración e imprevistos: se deja de OFRECER, no de mostrar', () => {
  it('con líneas por tipo no se invita a agregarlo', () => {
    expect(pintar({ lineasPorTipo: true })).not.toContain('+ Administración e imprevistos')
  })

  it('sin la marca, la invitación sigue ahí', () => {
    expect(pintar()).toContain('+ Administración e imprevistos')
  })

  it('una cotización que YA lo tiene lo sigue mostrando y editando', () => {
    // Esconder un porcentaje que está sumando sería la pantalla que miente. La
    // invitación es lo único que se retira.
    const html = pintar({
      lineasPorTipo: true,
      cotizacion: cotizacion({ aiu_admin_pct: 5, aiu_imprevistos_pct: 2 }),
    })
    expect(html).toContain('Administrativos (sobre el costo)')
    expect(html).toContain('Administración %')
  })
})

describe('las combinaciones dicen POR QUÉ no hay tabla', () => {
  it('sin alternativas, la pantalla explica qué falta', () => {
    const html = pintar({ lineasPorTipo: true, itinerarios: SIN_ALTERNATIVAS })
    expect(html).toContain('Combinaciones')
    expect(html).toContain('Agrega una alternativa a una línea')
    // Dice dónde está la acción, no solo que falta algo.
    expect(html).toContain('Agregar alternativa a esta línea')
    // Y la otra vía, que es la que destrabó el caso real: dos líneas sueltas compiten
    // solo si comparten grupo.
    expect(html).toContain('mismo grupo')
  })

  it('en una cotización que no es de viaje no se pinta nada (R6)', () => {
    const html = pintar({ itinerarios: SIN_ALTERNATIVAS })
    expect(html).not.toContain('Agrega una alternativa a una línea')
    expect(html).not.toContain('Todavía no hay nada que combinar')
  })
})

describe('los textos del flujo de viaje se guardan en MAYÚSCULA', () => {
  it('el nombre leído del pantallazo se pinta tal como quedó guardado', () => {
    const html = pintar({ lineasPorTipo: true })
    expect(html).toContain('LATAM BOGOTÁ–ORLANDO')
  })
})
