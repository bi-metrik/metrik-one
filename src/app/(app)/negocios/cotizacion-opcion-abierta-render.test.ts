/**
 * La opción de un bloque en el editor de Trappvel (P2 y P6 del ensayo del 2026-09-23, caso
 * Providencia), con la lectura REAL de la captura de Avianca.
 *
 *  · P6: la fila contraída dice lo que sirve para comparar, no el costo unitario ni la
 *    descripción larga, y nace contraída si ya está confirmada.
 *  · La tarjeta (prototipo aprobado el 2026-09-24): cabecera con «Opción N», el nombre, el
 *    precio y el menú ⋯; abierta, en orden: ficha, «Costo y precio» y la nota para el cliente.
 *    Sin costo confirmado, debajo queda lo que la opción todavía necesita a mano.
 *  · R6: fuera del flujo de viaje la línea no cambia (lo prueba además el golden de R6).
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

import fixture from '@/lib/cotizaciones/providencia-equipaje.fixture.json'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'

const LECTURA = (fixture as unknown as Record<string, Record<string, string | null>>)['01-vuelo1-bog-adz-avianca.png']
const CAMPOS = ranuraPorSlug('vuelo_detalle')!.campos
  .filter(c => LECTURA[c.slug] !== null && LECTURA[c.slug] !== undefined)
  .map(c => ({ label: c.label, valor: LECTURA[c.slug] as string }))

function opcion(extra: Record<string, unknown> = {}, tarifa: Record<string, unknown> = {}) {
  return {
    id: 'item-1', nombre: 'AVIANCA', subtotal: 1_000_000, orden: 1, precio_venta: 0,
    descuento_porcentaje: 0, descripcion: 'DESCRIPCIÓN LARGA QUE ESCRIBIÓ ONE', es_ajuste: false,
    cantidad: 1, margen_porcentaje: null, precio_manual: false, rubros: [], grupo: 'vuelo',
    opcion_de: null, unidad: null,
    tarifa_pax: {
      casillas: { grupo_completo: { moneda: 'COP', total: 1_000_000, campos: CAMPOS, alertas: [] } },
      descripcionDelSistema: 'DESCRIPCIÓN LARGA QUE ESCRIBIÓ ONE',
      ...tarifa,
    },
    ...extra,
  }
}

function pintar(items: unknown[], lineasPorTipo = true) {
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
      initialItems: items as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      lineasPorTipo,
      composicionViaje: { adultos: 2, ninos: 0, infantes: 1 },
    }),
  )
}

const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('P6 · la fila contraída de una opción', () => {
  it('dice número, horas y bodega; no el costo unitario ni la descripción larga', () => {
    const t = sinEtiquetas(pintar([opcion()]))
    expect(t).toContain('AV8520 · ida 06:05 → 08:20 · regreso 17:40 · bodega 23 kg')
    expect(t).not.toContain('Costo unit.')
    expect(t).not.toContain('DESCRIPCIÓN LARGA QUE ESCRIBIÓ ONE')
  })

  it('una opción ya confirmada nace contraída; una sin confirmar, abierta', () => {
    const confirmada = {
      confirmada: {
        composicion: { adultos: 2, ninos: 0, infantes: 1 },
        costos: [{ tipo: 'adulto', cantidad: 2, unitarioCOP: 500_000, totalCOP: 1_000_000 }],
        costoTotalCOP: 1_000_000, moneda: 'COP', tasa: null, confirmadaEn: '2026-09-23T12:00:00Z',
      },
    }
    expect(pintar([opcion({}, confirmada)])).not.toContain('data-opcion-abierta')
    expect(pintar([opcion()])).toContain('data-opcion-abierta="item-1"')
  })

  it('R6: fuera del flujo de viaje la fila sigue diciendo el costo unitario', () => {
    expect(sinEtiquetas(pintar([opcion()], false))).toContain('Costo unit.')
  })
})

describe('la tarjeta de la opción abierta', () => {
  it('va en orden: cabecera con su menú, ficha, costo y precio, nota', () => {
    const html = pintar([opcion()])
    const posiciones = [
      html.indexOf('data-tarjeta-opcion="item-1"'),
      html.indexOf('>Opción 1<'),
      html.indexOf('aria-label="Más acciones"'),
      html.indexOf('Ida lun 9 nov · BOG 06:05 → ADZ 08:20 · directo'),
      html.indexOf('data-costo-precio'),
      html.indexOf('Nota para el cliente'),
    ]
    expect(posiciones.every(p => p > 0)).toBe(true)
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)
    expect(sinEtiquetas(html)).toContain('2 adultos, 1 infante')
  })

  it('la descripción que escribió ONE no es nota; la de una persona sí', () => {
    const deOne = pintar([opcion()])
    expect(deOne).not.toContain('>DESCRIPCIÓN LARGA QUE ESCRIBIÓ ONE<')
    const dePersona = pintar([opcion({ descripcion: 'INCLUYE TRASLADO AL HOTEL' })])
    expect(dePersona).toContain('>INCLUYE TRASLADO AL HOTEL</textarea>')
  })

  it('sin costo confirmado, la tabla dice el total y debajo queda lo que falta hacer a mano', () => {
    const html = pintar([opcion()])
    const t = sinEtiquetas(html)
    expect(t).toMatch(/Total 1\.000\.000 \$1\.176\.471/)
    expect(t).toMatch(/Margen 15 %/)
    expect(html).toContain('data-respaldo-opcion')
  })

  it('el botón «Usar solo para restar» ya no existe', () => {
    expect(pintar([opcion()])).not.toContain('Usar solo para restar')
  })

  it('sin papelera suelta: borrar vive en el menú ⋯', () => {
    const html = pintar([opcion()])
    expect(html).toContain('aria-label="Más acciones"')
    expect(html).not.toContain('data-eliminar-opcion')
  })
})

describe('P7 · cada bloque dice si está completo', () => {
  const confirmada = {
    confirmada: {
      composicion: { adultos: 2, ninos: 0, infantes: 1 },
      costos: [{ tipo: 'adulto', cantidad: 2, unitarioCOP: 500_000, totalCOP: 1_000_000 }],
      costoTotalCOP: 1_000_000, moneda: 'COP', tasa: null, confirmadaEn: '2026-09-23T12:00:00Z',
    },
  }

  it('sin confirmar: el bloque requiere atención y el paso lo cuenta', () => {
    const t = sinEtiquetas(pintar([opcion()]))
    expect(t).toContain('1 bloque · 0 completos · 1 requiere atención')
    expect(t).toContain('Ir al primero que falta')
  })

  it('el aviso de impuestos en destino solo informa: no deja el bloque por atender', () => {
    const IMPUESTOS = 'Impuestos y tasas a pagar en destino: 82,31 USD. Los paga el pasajero en el hotel: van al cliente como nota, no al costo.'
    const conNota = opcion({}, {
      ...confirmada,
      casillas: { grupo_completo: { moneda: 'COP', total: 1_000_000, campos: CAMPOS, alertas: [IMPUESTOS] } },
    })
    expect(sinEtiquetas(pintar([conNota]))).toContain('1 bloque · 1 completo')
    const conOtra = opcion({}, {
      ...confirmada,
      casillas: { grupo_completo: { moneda: 'COP', total: 1_000_000, campos: CAMPOS, alertas: [IMPUESTOS, 'La fecha de regreso no se ve'] } },
    })
    expect(sinEtiquetas(pintar([conOtra]))).toContain('1 requiere atención')
  })

  it('confirmada y con costo: completo, y la tabla trae una fila por pasajero sin respaldo a mano', () => {
    const html = pintar([opcion({}, confirmada)])
    const t = sinEtiquetas(html)
    expect(t).toContain('1 bloque · 1 completo')
    expect(t).not.toContain('Ir al primero que falta')
    expect(html).not.toContain('data-respaldo-opcion')
  })
})
