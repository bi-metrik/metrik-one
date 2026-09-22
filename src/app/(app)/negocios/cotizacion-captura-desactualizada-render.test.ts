/**
 * Brief del 2026-09-22 · lo que el EDITOR de la cotización tiene que decir cuando cambian los
 * pasajeros y cuando el costo es en otra moneda.
 *
 *  · Parte 1: un aviso visible, a nivel de la cotización, que liste las líneas con captura
 *    desactualizada. El cambio casi nunca pasa en la cotización —pasa en el negocio—, así
 *    que con las líneas cerradas la alerta de cada una no se ve.
 *  · Parte 2: el costo escrito a mano de una línea de viaje declara su moneda, COP por
 *    defecto. Fuera del flujo de viaje la casilla sigue en pesos (R6).
 *
 * ⚠️ Por qué RENDER: las reglas puras (`captura-desactualizada.test.ts`) pueden estar bien y
 * el editor no montar el aviso. Y cada caso se afirma también por la NEGATIVA: sin la mitad
 * negativa, un aviso que sale siempre pasa igual de verde.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
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
  corregirCampoDeFicha: async () => ({ success: true }),
  elegirMonedaDeTarifa: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/costo-manual-actions', () => ({
  guardarCostoManualEnMoneda: async () => ({ success: true }),
}))

const { default: CotizacionEditor } = await import('./cotizacion-editor')

/** Una casilla leída para 2 adultos: el pantallazo que queda viejo si el viaje pasa a 3. */
const LECTURA_DOS_ADULTOS = {
  moneda: 'COP', total: 2_000_000, aPagarAgencia: null, porTipo: [],
  ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 }, ocupacionDelItem: false,
  identidad: {}, notasCliente: [], alertas: [], campos: [], nombre: 'Hotel', descripcion: '',
  leidaEn: '2026-09-22T12:00:00Z', paraComposicion: { adultos: 2, ninos: 0, infantes: 0 },
}

const HOTEL = {
  id: 'item-hotel', nombre: 'DECAMERON CARTAGENA', subtotal: 0, orden: 1, precio_venta: 0,
  descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
  margen_porcentaje: null, precio_manual: false, rubros: [], grupo: 'hotel', opcion_de: null,
  unidad: null, tarifa_pax: { casillas: { grupo_completo: LECTURA_DOS_ADULTOS } },
}

const SEGURO = {
  id: 'item-seguro', nombre: 'SEGURO DE VIAJE', subtotal: 480_000, orden: 2, precio_venta: 0,
  descuento_porcentaje: 0, descripcion: null, es_ajuste: false, cantidad: 1,
  margen_porcentaje: null, precio_manual: false, rubros: [], grupo: null, opcion_de: null,
  unidad: null, tarifa_pax: null,
}

function pintar(args: {
  composicionViaje: { adultos: number; ninos: number; infantes: number } | null
  estado?: string
  items?: unknown[]
  lineasPorTipo?: boolean
}) {
  return renderToStaticMarkup(
    React.createElement(CotizacionEditor, {
      oportunidadId: 'neg-1',
      cotizacion: {
        id: 'cot-1', codigo: 'COT-2026-0002', consecutivo: 'COT-2026-0002', modo: 'detallada',
        estado: args.estado ?? 'borrador', descripcion: null, valor_total: 0, margen_porcentaje: 15,
        costo_total: 0, fecha_envio: null, fecha_validez: null, descuento_porcentaje: 0,
        convencion_margen: 'sobre_venta',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialItems: (args.items ?? [HOTEL, SEGURO]) as any,
      umbrales: { pisoPct: 5, avisoPct: 10 },
      composicionViaje: args.composicionViaje,
      lineasPorTipo: args.lineasPorTipo ?? true,
    }),
  )
}

const sinEtiquetas = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('parte 1 · el aviso de la cotización nombra las líneas con captura vieja', () => {
  it('el viaje pasó de 2 a 3 adultos: el aviso nombra la línea y dice qué hacer', () => {
    const texto = sinEtiquetas(pintar({ composicionViaje: { adultos: 3, ninos: 0, infantes: 0 } }))
    expect(texto).toContain('Una línea tiene el pantallazo de otros pasajeros: su precio no corresponde al viaje de hoy.')
    // El nombre va en su propio nodo (negrita): sin etiquetas queda «» : con un espacio.
    expect(texto).toContain('«DECAMERON CARTAGENA» : Este pantallazo es para 2 adultos y la línea ahora cubre 3 adultos: pega uno nuevo.')
    expect(texto).toContain('Pega el pantallazo nuevo en cada una y vuelve a confirmar su costo antes de enviar la cotización.')
    // La línea sin ranura (el seguro) no tiene capturas: no aparece.
    expect(texto).not.toContain('«SEGURO DE VIAJE»')
  })

  it('con los pasajeros con que se buscó, no hay aviso', () => {
    const texto = sinEtiquetas(pintar({ composicionViaje: { adultos: 2, ninos: 0, infantes: 0 } }))
    expect(texto).not.toContain('pantallazo de otros pasajeros')
  })

  it('fuera de borrador el aviso no manda a pegar: manda a duplicar (regla de Mauricio)', () => {
    const texto = sinEtiquetas(pintar({ composicionViaje: { adultos: 3, ninos: 0, infantes: 0 }, estado: 'enviada' }))
    expect(texto).toContain('pantallazo de otros pasajeros')
    expect(texto).toContain('Esta cotización ya no se edita: duplícala para cotizar con los pasajeros de hoy.')
    expect(texto).not.toContain('Pega el pantallazo nuevo en cada una')
  })
})

describe('parte 2 · el costo a mano de una línea de viaje declara su moneda', () => {
  it('en el flujo de viaje: selector de moneda, COP por defecto', () => {
    const html = pintar({ composicionViaje: null, items: [SEGURO] })
    expect(html).toContain('aria-label="Moneda del costo"')
    expect(html).toMatch(/<option value="COP" selected="">COP<\/option>/)
    expect(html).toContain('aria-label="Costo unitario en COP"')
  })

  it('anotado en USD: lo escrito se muestra con su tasa y los pesos que resultan', () => {
    const enUSD = {
      ...SEGURO,
      subtotal: 498_000,
      tarifa_pax: { costoManual: { moneda: 'USD', valor: 120, tasa: 4150, por: null, porId: null, en: '2026-09-22T10:00:00Z' } },
    }
    const html = pintar({ composicionViaje: null, items: [enUSD] })
    const texto = sinEtiquetas(html)
    expect(html).toMatch(/<option value="USD" selected="">USD<\/option>/)
    expect(html).toContain('value="4150"')
    expect(texto).toContain('en pesos. El sistema no consulta la TRM.')
  })

  it('fuera del flujo de viaje (Termotech, Arca, WMC): la casilla en pesos de siempre', () => {
    const html = pintar({ composicionViaje: null, items: [SEGURO], lineasPorTipo: false })
    expect(html).not.toContain('aria-label="Moneda del costo"')
    expect(sinEtiquetas(html)).toContain('Lo que le pagas al proveedor')
  })
})
