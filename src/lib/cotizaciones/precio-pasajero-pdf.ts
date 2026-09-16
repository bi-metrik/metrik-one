/**
 * El precio por pasajero que imprime el PDF, por línea y del viaje entero (diseño §4).
 *
 * Puro y aparte de la server action del PDF: lo que se le dice al cliente sobre cuánto paga
 * cada uno se prueba sin base y sin renderizar.
 */

import {
  confirmadaVigente,
  leerTarifaPax,
  precioPorPasajero,
  TIPOS_PASAJERO,
  type PrecioPorPasajero,
  type TipoPasajero,
} from './tarifa-pasajero'

export interface ItemConTarifa {
  precio_venta?: number | null
  es_ajuste?: boolean | null
  tarifa_pax?: unknown
  rubros?: { valor_total: number | null; sugerido?: boolean | null }[] | null
}

/**
 * El precio de un pasajero de cada tipo en la línea, o `null` si la línea se cobra por el
 * grupo.
 *
 * ⚠️ `null` también cuando el costo por pasajero confirmado ya no es el costo de la línea
 * (alguien editó los rubros después). Imprimir ese reparto le diría al cliente cuánto paga
 * cada uno con los números de otra versión de la cotización.
 */
export function precioPorPasajeroDeItem(item: ItemConTarifa): PrecioPorPasajero[] | null {
  if (item.es_ajuste) return null
  const { confirmada } = leerTarifaPax(item.tarifa_pax)
  if (!confirmada) return null
  const costoUnitario = (item.rubros ?? [])
    .filter(r => r.sugerido !== true)
    .reduce((a, r) => a + (Number(r.valor_total) || 0), 0)
  if (!confirmadaVigente(confirmada, costoUnitario)) return null
  return precioPorPasajero(confirmada, Number(item.precio_venta) || 0)
}

export interface LineaParaTotal {
  nombre: string
  precio_venta: number
  cantidad: number
  precioPorPasajero?: PrecioPorPasajero[] | null
}

/**
 * Por cada tipo, la suma del precio de cada componente que lo incluye.
 *
 * Un tipo que ninguna línea incluye no aparece: un «Infante $0» afirmaría que el infante
 * viaja gratis cuando en realidad ninguna línea lo cotizó. Lo que se cobra por el grupo
 * (el seguro, un fee, una línea sin tarifa por pasajero) no se reparte a ojo: se nombra.
 *
 * `null` cuando ninguna línea trae precio por pasajero: la sección no existe.
 */
export function preciosPorPasajeroDelViaje(
  lineas: LineaParaTotal[],
): { filas: { tipo: TipoPasajero; precioUnitario: number }[]; sinReparto: string[] } | null {
  const conReparto = lineas.filter(l => l.precioPorPasajero && l.precioPorPasajero.length > 0)
  if (conReparto.length === 0) return null

  const filas = TIPOS_PASAJERO
    .map(tipo => {
      const incluyen = conReparto
        .map(l => ({ l, p: (l.precioPorPasajero ?? []).find(x => x.tipo === tipo) }))
        .filter(x => x.p !== undefined)
      if (incluyen.length === 0) return null
      const precioUnitario = incluyen.reduce((a, x) => a + (x.p as PrecioPorPasajero).precioUnitario * (x.l.cantidad || 1), 0)
      return { tipo, precioUnitario }
    })
    .filter((f): f is { tipo: TipoPasajero; precioUnitario: number } => f !== null)

  const sinReparto = lineas
    .filter(l => !(l.precioPorPasajero && l.precioPorPasajero.length > 0) && (Number(l.precio_venta) || 0) > 0)
    .map(l => l.nombre || 'Componente sin nombre')

  return { filas, sinReparto }
}
