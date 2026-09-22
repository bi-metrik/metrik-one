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
  /**
   * Los adicionales de la línea, en palabras. Su plata **no está** en el reparto por
   * pasajero: `precioPorPasajeroDeItem` reparte `items.precio_venta`, que es el precio
   * BASE de la variante, y la maleta extra se suma aparte (`valorAdicionales`).
   */
  adicionales?: string[]
}

interface FilaPorPasajero {
  tipo: TipoPasajero
  /** Cuántos viajan de ese tipo. `null` si las líneas no coinciden en el número. */
  cantidad: number | null
  /** Lo que paga UNO de ese tipo, sumando todos los componentes que lo incluyen. */
  precioUnitario: number
}

export interface PreciosPorPasajeroPDF {
  filas: FilaPorPasajero[]
  /**
   * Lo que la tabla por pasajero cubre: Σ `precioUnitario × cantidad`.
   *
   * `null` cuando alguna fila no sabe cuántos son, y entonces la tabla NO se puede
   * reconciliar contra el total: el documento tiene que decirlo en vez de dejar dos
   * cifras que no cierran una debajo de la otra.
   */
  cubierto: number | null
  /** Lo que queda FUERA de esa suma, por su nombre. */
  sinReparto: string[]
}

/**
 * Por cada tipo, la suma del precio de cada componente que lo incluye.
 *
 * Un tipo que ninguna línea incluye no aparece: un «Infante $0» afirmaría que el infante
 * viaja gratis cuando en realidad ninguna línea lo cotizó. Lo que se cobra por el grupo
 * (el seguro, un fee, una línea sin tarifa por pasajero) no se reparte a ojo: se nombra.
 *
 * `null` cuando ninguna línea trae precio por pasajero: la sección no existe.
 *
 * ## ⚠️⚠️ Por qué esta función ahora devuelve `cubierto`
 *
 * Hasta el 2026-09-22 el documento imprimía la tabla por pasajero y el TOTAL **como dos
 * hechos sueltos**, y nada comprobaba que el uno explicara al otro. En la prueba real de
 * Providencia la suma por pasajero daba 13.861.000 contra un total de 14.221.000: los
 * 360.000 de diferencia eran el equipaje de bodega adicional, que vive en
 * `valorAdicionales` y **nunca entró** al reparto. Con una persona armando precios a mano
 * ese hueco sale solo, y sale delante de un cliente.
 *
 * `cubierto` es lo que la tabla explica. Quien imprime resta `total − cubierto` y publica
 * la diferencia **con nombre**: así la resta cierra por construcción y el cliente puede
 * sumar la columna. Lo que NO se hace es repartir la diferencia entre los pasajeros: una
 * maleta la compra alguien concreto y prorratearla sería inventar quién paga qué.
 */
export function preciosPorPasajeroDelViaje(
  lineas: LineaParaTotal[],
): PreciosPorPasajeroPDF | null {
  const conReparto = lineas.filter(l => l.precioPorPasajero && l.precioPorPasajero.length > 0)
  if (conReparto.length === 0) return null

  const filas = TIPOS_PASAJERO
    .map((tipo): FilaPorPasajero | null => {
      const incluyen = conReparto
        .map(l => ({ l, p: (l.precioPorPasajero ?? []).find(x => x.tipo === tipo) }))
        .filter((x): x is { l: LineaParaTotal; p: PrecioPorPasajero } => x.p !== undefined)
      if (incluyen.length === 0) return null
      const precioUnitario = incluyen.reduce((a, x) => a + x.p.precioUnitario * (x.l.cantidad || 1), 0)
      // ⚠️ El número de viajeros solo se afirma si TODAS las líneas que cotizan ese tipo
      // dicen lo mismo. Con un vuelo para 6 adultos y un hotel para 4, multiplicar por
      // cualquiera de los dos daría un subtotal que no es el de nadie.
      const cuentas = new Set(incluyen.map(x => x.p.cantidad))
      const cantidad = cuentas.size === 1 ? [...cuentas][0] : null
      return { tipo, cantidad, precioUnitario }
    })
    .filter((f): f is FilaPorPasajero => f !== null)

  const cubierto = filas.every(f => f.cantidad !== null)
    ? filas.reduce((a, f) => a + f.precioUnitario * (f.cantidad as number), 0)
    : null

  const sinReparto = [
    // Las líneas que no reparten: la suya es plata del grupo entera.
    ...lineas
      .filter(l => !(l.precioPorPasajero && l.precioPorPasajero.length > 0) && (Number(l.precio_venta) || 0) > 0)
      .map(l => l.nombre || 'Componente sin nombre'),
    // Y los adicionales de las que SÍ reparten: la línea está repartida, su maleta no.
    ...conReparto.flatMap(l => l.adicionales ?? []),
  ]

  return { filas, cubierto, sinReparto }
}
