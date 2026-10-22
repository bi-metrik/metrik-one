/**
 * «¿Por qué ahora es en cero?» (reunión con Trappvel del 2026-10-22, L1977-1991).
 *
 * La causa: el margen de la cotización («uno para las tres tarifas») solo alcanza a las opciones
 * que lo HEREDAN (`items.margen_porcentaje = null`). En la prueba, a cada vuelo, hotel y traslado
 * se le había puesto margen 0 en su tarjeta (sus precios ya traían la comisión). Al subir el margen
 * de la cotización a 15 no cambió nada: cada opción seguía con su 0 propio, el margen real de las
 * tarifas siguió en 0 y la pantalla no decía por qué.
 *
 * Es la misma necesidad del punto 1 (tarifa pública): con «Pública» ya no hace falta poner 0 a
 * mano, y esas líneas no cuentan para el mínimo. Lo que queda es que la pantalla DIGA qué opciones
 * no siguen el margen de la cotización y deje volverlas a él de un clic. Eso es esta pieza.
 *
 * Puro.
 */

import { origenDelMargen } from './margen-vista'
import { margenDeLineaSegunConvencion } from './margen-proveedor'
import { CONVENCION_MARGEN_POR_DEFECTO, type ConvencionMargen } from './precio-item'
import { esTarifaPublica } from './tarifa-publica'

export interface LineaParaMargenPropio {
  id: string
  margen_porcentaje?: number | null
  precio_manual?: boolean | null
  es_ajuste?: boolean | null
  tarifa_pax?: unknown
}

/** Lo mismo que considera «el mismo número» `margen-vista.ts`. */
const MISMO = 0.005

/** El margen del proveedor guardado en la confirmación, en la convención de la cotización. */
function margenDelProveedor(tarifaPax: unknown, convencion: ConvencionMargen): number | null {
  const conf = (tarifaPax as { confirmada?: { margenProveedor?: unknown } } | null)?.confirmada
  const m = conf?.margenProveedor as { margenPct?: unknown; precioCliente?: unknown; costoAgencia?: unknown } | null | undefined
  if (!m || typeof m.margenPct !== 'number' || typeof m.precioCliente !== 'number' || typeof m.costoAgencia !== 'number') return null
  return margenDeLineaSegunConvencion(m as never, convencion)
}

/**
 * Las opciones Netas que llevan un margen PROPIO distinto al de la cotización, escrito por una
 * persona: no se mueven con el margen de las tres tarifas. No cuentan las Públicas (su 0 es a
 * propósito), las de precio escrito a mano (el precio manda) ni las que traen el margen del
 * proveedor (la captura mostró precio al cliente y costo de la agencia).
 */
export function lineasConMargenPropio<T extends LineaParaMargenPropio>(
  lineas: readonly T[],
  margenCotizacion: number,
  convencion: ConvencionMargen | null | undefined,
): T[] {
  const conv = convencion ?? CONVENCION_MARGEN_POR_DEFECTO
  return lineas.filter(l => {
    if (l.es_ajuste === true || l.precio_manual === true) return false
    if (l.margen_porcentaje === null || l.margen_porcentaje === undefined) return false
    if (esTarifaPublica(l.tarifa_pax)) return false
    const actual = Number(l.margen_porcentaje)
    if (!Number.isFinite(actual) || Math.abs(actual - (Number(margenCotizacion) || 0)) < MISMO) return false
    const origen = origenDelMargen({
      margenPropio: true,
      precioManual: false,
      margenDelPantallazo: margenDelProveedor(l.tarifa_pax, conv),
      margenActual: actual,
    })
    return origen === 'propio'
  })
}
