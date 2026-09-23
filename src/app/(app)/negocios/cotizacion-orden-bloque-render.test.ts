/**
 * El orden del bloque de un ítem de VIAJE (diseño `orden-del-bloque-de-item.md`, 2026-09-21).
 *
 * Las tres observaciones que se resuelven aquí son de posición y de oferta, no de cálculo:
 *
 *  · §2.2 — «Agregar otra opción de vuelo» estaba ARRIBA, entre el nombre y el contenido,
 *    así que se leía como si aplicara a lo que venía abajo. Va al pie, después del costo y
 *    la descripción.
 *  · §2.3 — el GRUPO lo fijó el botón que se apretó («+ Vuelo») y el chip del encabezado ya
 *    lo dice. Sale de la primera fila y pasa a una acción secundaria.
 *  · §2.5 — en un viaje NO se ofrecen rubros: el desglose lo trae el pantallazo y agregar un
 *    rubro anula el costo escrito.
 *
 * ⚠️ Por qué RENDER: las tres son del JSX. No hay una función pura que se pueda poner roja;
 * una prueba de helpers seguiría en verde con el botón en el sitio equivocado.
 *
 * ⚠️ Y por qué se afirma el caso CONTRARIO en cada una: el diseño prohíbe tocar el bloque de
 * Termotech, Arca y WMC. Sin la mitad negativa, mover algo «para todos» pasa igual de verde.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

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

const { default: CotizacionEditor } = await import('./cotizacion-editor')

const ITEM = {
  id: 'item-1', nombre: 'AVIANCA BOG–PUJ', subtotal: 1_000_000, orden: 1, precio_venta: 0,
  descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
  margen_porcentaje: null, precio_manual: false, rubros: [], grupo: 'vuelo', opcion_de: null,
  unidad: null,
}

function pintar(lineasPorTipo: boolean) {
  return renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: {
        id: 'cot-1', codigo: 'COT-2026-0002', consecutivo: 'COT-2026-0002', modo: 'detallada',
        estado: 'borrador', descripcion: null, valor_total: 0, margen_porcentaje: 15,
        costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
        convencion_margen: 'sobre_venta',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: [ITEM] as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      lineasPorTipo,
    }),
  )
}

/** El texto visible, sin etiquetas: sirve para medir el ORDEN de dos cosas en pantalla. */
const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('§2.5 · en un viaje no se ofrecen rubros', () => {
  it('con líneas por tipo, «Agregar rubro» no está', () => {
    expect(sinEtiquetas(pintar(true))).not.toContain('Agregar rubro')
  })

  it('sin líneas por tipo (Termotech, Arca, WMC) sigue estando', () => {
    expect(sinEtiquetas(pintar(false))).toContain('Agregar rubro')
  })
})

describe('§2.3 · el grupo sale de la primera fila', () => {
  it('con líneas por tipo, el desplegable vive detrás del menú ⋯ de la opción («Pasar a otra ranura…»)', () => {
    const html = pintar(true)
    expect(html).toContain('aria-label="Más acciones de la opción"')
    expect(html).not.toContain('aria-label="Grupo de la línea"')
  })

  it('sin líneas por tipo, el desplegable sigue en la ficha', () => {
    const html = pintar(false)
    expect(html).toContain('aria-label="Grupo de la línea"')
    expect(sinEtiquetas(html)).not.toContain('Mover a otra opción')
  })
})

describe('§2.2 · «Agregar otra opción» va al pie', () => {
  it('con líneas por tipo sube al ENCABEZADO del bloque como «+ Opción» (P6), antes de las opciones', () => {
    // Con tres opciones abiertas el botón del pie quedaba lejos y su ayuda parecía del bloque
    // siguiente (caso Providencia, 2026-09-23).
    const html = pintar(true)
    expect(html).toContain('title="Agregar otra opción de vuelo"')
    expect(html.indexOf('title="Agregar otra opción de vuelo"'))
      .toBeLessThan(html.indexOf('data-opcion-abierta'))
    // La descripción editable ya no está en la opción de un bloque: su lugar es la nota.
    expect(sinEtiquetas(html)).not.toContain('Descripción (visible al cliente)')
    expect(sinEtiquetas(html)).toContain('Nota para el cliente')
  })

  it('sin líneas por tipo se queda donde estaba: ANTES del costo', () => {
    const texto = sinEtiquetas(pintar(false))
    expect(texto).toContain('Agregar otra opción de vuelo')
    expect(texto.indexOf('Agregar otra opción de vuelo'))
      .toBeLessThan(texto.indexOf('Costo de la línea'))
  })
})


/**
 * El editor MONTA la seccion de adicionales en la linea de viaje (y solo ahi).
 *
 * ⚠️ Su prueba de componente (`adicionales-render.test.ts`) mide que el componente pinta
 * bien; no mide que el editor lo cuelgue. Son dos cosas distintas y la segunda es la que
 * se rompe al mover un bloque de sitio: el componente seguiria perfecto y la seccion no
 * existiria en pantalla.
 *
 * La mitad negativa es la que sostiene R6: una linea SIN ranura del catalogo —o sea toda
 * cotizacion de Termotech, Arca y WMC— no gana una seccion al abrirse.
 */
describe('adicionales: el editor los monta donde corresponde', () => {
  function pintarCon(item: Record<string, unknown>, adicionales?: Record<string, unknown>) {
    return renderToStaticMarkup(
      React.createElement(CotizacionEditor, {
        oportunidadId: 'neg-1',
        cotizacion: {
          id: 'cot-1', codigo: 'COT-2026-0002', consecutivo: 'COT-2026-0002', modo: 'detallada',
          estado: 'borrador', descripcion: null, valor_total: 0, margen_porcentaje: 15,
          costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
          convencion_margen: 'sobre_venta',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialItems: [item] as any,
        umbrales: { pisoPct: 5, avisoPct: 10 },
        lineasPorTipo: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        adicionales: adicionales as any,
      }),
    )
  }

  const ROTULO = 'Adicionales de esta opcion'.replace('opcion', 'opción')

  it('en una linea de VUELO la seccion existe', () => {
    const t = sinEtiquetas(pintarCon(ITEM, { disponible: true, porItem: {} }))
    expect(t).toContain(ROTULO)
  })

  it('R6 . en una linea SIN ranura del catalogo no existe', () => {
    const t = sinEtiquetas(pintarCon({ ...ITEM, grupo: null }, { disponible: true, porItem: {} }))
    expect(t).not.toContain(ROTULO)
  })

  it('sin la migracion aplicada tampoco existe: el deploy va antes que el SQL', () => {
    const t = sinEtiquetas(pintarCon(ITEM, { disponible: false, porItem: {} }))
    expect(t).not.toContain(ROTULO)
  })

  it('sin la prop (la otra ruta que monta el editor) no existe', () => {
    const t = sinEtiquetas(pintarCon(ITEM))
    expect(t).not.toContain(ROTULO)
  })
})
