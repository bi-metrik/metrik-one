/**
 * El equipaje comprado aparte llega al documento del cliente, con su propio margen.
 *
 * Pedido de Alejandra el 2026-09-16 (§4.3 de `propuesta-visual.md`): *«Avianca no deja
 * cotizar con equipaje en ciertas reservas; se compra después por la página o por
 * teléfono. Va como ítem del grupo "Otro", con su propio margen. Falta verificar que
 * salga en el PDF.»*
 *
 * ## Qué es «el grupo Otro» en los datos
 *
 * El botón «+ Otro» del editor crea una línea con nombre libre y **`grupo` en `null`**:
 * los grupos son las ranuras con pantallazo (vuelo, hotel, actividad, traslado) y ésta no
 * es ninguna. Ese `null` la atraviesa TRES filtros distintos antes de imprimirse, y cada
 * uno pudo haberla dejado fuera sin que nada fallara:
 *
 *  1. `itemsQueAportanAlTotal` — que no la trate como candidata de una ranura.
 *  2. `puedeSerSugerido` — que NO la mande a «actividades adicionales no incluidas», que
 *     es la sección de lo que el cliente *no* está comprando.
 *  3. La partición por días del PDF — que sin día no se quede sin sección.
 *
 * Por eso la prueba recorre la cadena entera y termina leyendo el BINARIO del documento:
 * las tres reglas pueden estar bien y el PDF imprimir otra cosa.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'

import CotizacionPDF from './cotizacion-pdf'
import type { CotizacionPDFProps } from './cotizacion-props'
import { textoDelPDF } from './texto-del-pdf'
import { itemsQueAportanAlTotal } from '@/lib/cotizaciones/itinerarios'
import { diasDelItinerario, itemsSugeridos } from '@/lib/cotizaciones/dia-relativo'
import { calcularCascada } from '@/lib/cotizaciones/totales'

const props = (over: Partial<CotizacionPDFProps>): CotizacionPDFProps => ({
  cotizacion: {
    consecutivo: 'COT-2026-0200',
    descripcion: null,
    valor_total: 0,
    modo: 'detallada',
    fecha_envio: null,
    fecha_validez: null,
    condiciones_pago: null,
    notas: null,
    descuento_porcentaje: 0,
    descuento_valor: 0,
  },
  empresa: { nombre: 'Cliente', nit: null, contacto_nombre: null, contacto_email: null, telefono: null, direccion: null, ciudad: null },
  vendedor: { nombre: 'Trappvel', razon_social: null, nit: null, logo_url: null, color_primario: '#10B981', telefono: null, email: null, direccion: null, ciudad: null },
  items: [],
  fiscal: null,
  ...over,
})

async function texto(p: CotizacionPDFProps): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buf = await renderToBuffer(createElement(CotizacionPDF, p) as any)
  return textoDelPDF(Buffer.from(buf)).split(String.fromCharCode(0xa0)).join(' ')
}

/**
 * El caso real: dos vuelos alternativos en la ranura, un hotel, y el equipaje comprado
 * aparte. `grupo: null` es exactamente lo que escribe «+ Otro».
 */
const LINEAS = [
  { id: 'v1', grupo: 'vuelo', opcion_de: null, es_ajuste: false, orden: 0, dia_relativo: null, entra_al_precio: null },
  { id: 'v2', grupo: 'vuelo', opcion_de: 'v1', es_ajuste: false, orden: 1, dia_relativo: null, entra_al_precio: null },
  { id: 'h1', grupo: 'hotel', opcion_de: null, es_ajuste: false, orden: 2, dia_relativo: 1, entra_al_precio: null },
  { id: 'eq', grupo: null, opcion_de: null, es_ajuste: false, orden: 3, dia_relativo: null, entra_al_precio: null },
]

describe('el equipaje comprado aparte («+ Otro») llega al documento', () => {
  it('aporta al total aunque haya una ranura con alternativas', () => {
    const aportan = itemsQueAportanAlTotal(LINEAS)
    expect(aportan).toContain('eq')
    // Y la ranura con alternativas sigue aportando UNA sola vez (R-A1).
    expect(aportan.filter(id => id === 'v1' || id === 'v2')).toHaveLength(1)
  })

  // Una línea sin grupo NO se puede declarar «no incluida»: nadie hizo esa declaración.
  // Si cayera ahí, el cliente vería su equipaje en la lista de lo que NO está comprando.
  it('NO cae en «actividades adicionales no incluidas»', () => {
    expect(itemsSugeridos(LINEAS)).not.toContain('eq')
  })

  it('con la cotización organizada por días, queda en la sección de lo que no lleva día', () => {
    const bloques = diasDelItinerario(LINEAS)
    expect(bloques.flatMap(d => d.itemIds)).not.toContain('eq')
    const conDia = new Set(bloques.flatMap(d => d.itemIds))
    const sugeridos = new Set(itemsSugeridos(LINEAS))
    const sinDia = itemsQueAportanAlTotal(LINEAS).filter(id => !conDia.has(id) && !sugeridos.has(id))
    expect(sinDia).toContain('eq')
  })

  it('lleva SU margen, distinto del de la cotización', () => {
    const cascada = calcularCascada(
      [
        { id: 'h1', numeroDeRubros: 1, costoDeRubros: 1_000_000, cantidad: 1, margen_porcentaje: null },
        // 30% propio sobre los 120.000 que cobra Avianca por la maleta.
        { id: 'eq', numeroDeRubros: 1, costoDeRubros: 120_000, cantidad: 1, margen_porcentaje: 30 },
      ],
      { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' },
    )
    const equipaje = cascada.lineas.find(l => l.id === 'eq')!
    expect(Math.round(equipaje.precioLinea)).toBe(171_429)
    // El hotel hereda el 15% de la cotización: el margen propio del equipaje no lo mueve.
    expect(Math.round(cascada.lineas.find(l => l.id === 'h1')!.precioLinea)).toBe(1_176_471)
  })

  it('el documento lo imprime y lo suma, con la cotización por días', async () => {
    const t = await texto(props({
      items: [
        { nombre: 'HOTEL CROWN PARADISE', descripcion: null, precio_venta: 1_176_471, descuento_porcentaje: 0, cantidad: 1 },
        { nombre: 'EQUIPAJE DE BODEGA COMPRADO APARTE', descripcion: null, precio_venta: 171_429, descuento_porcentaje: 0, cantidad: 1 },
      ],
      dias: [{ dia: 1, items: [{ nombre: 'HOTEL CROWN PARADISE', descripcion: null, precio_venta: 1_176_471, descuento_porcentaje: 0, cantidad: 1 }] }],
      itemsSinDia: [{ nombre: 'EQUIPAJE DE BODEGA COMPRADO APARTE', descripcion: null, precio_venta: 171_429, descuento_porcentaje: 0, cantidad: 1 }],
    }))
    expect(t).toContain('EQUIPAJE DE BODEGA COMPRADO APARTE')
    expect(t).not.toContain('no incluidas')
    // Suma: 1.176.471 + 171.429 = 1.347.900.
    expect(t).toMatch(/1\.347\.900/)
  })

  it('sin días, el documento lo imprime en la tabla plana de siempre', async () => {
    const t = await texto(props({
      items: [
        { nombre: 'VUELO AVIANCA BOG–AXM', descripcion: null, precio_venta: 1_000_000, descuento_porcentaje: 0, cantidad: 1 },
        { nombre: 'EQUIPAJE DE BODEGA COMPRADO APARTE', descripcion: null, precio_venta: 171_429, descuento_porcentaje: 0, cantidad: 1 },
      ],
    }))
    expect(t).toContain('EQUIPAJE DE BODEGA COMPRADO APARTE')
    expect(t).toMatch(/1\.171\.429/)
  })
})
