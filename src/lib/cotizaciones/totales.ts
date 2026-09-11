/**
 * La cascada de una cotización: de lo que cuesta a lo que se cobra.
 *
 * Una cotización se arma en un solo sentido y cada escalón tiene un dueño distinto:
 *
 *   costo directo        Σ (costo unitario × cantidad − descuento de compra)
 * + administrativos      lo que cuesta operar el contrato (AIU), un % sobre el costo
 * = costo de venta       la plata que hay que poner para entregar el trabajo
 * + margen               la utilidad, global o propia de una línea
 * − descuento comercial  lo que se cede para cerrar
 * = precio de venta      lo que paga el cliente
 *
 * Dos cosas que parecen detalle y no lo son:
 *
 *  · El descuento del ítem es de COMPRA: baja el costo, no el precio. El que baja el
 *    precio es el comercial y vive al final. Aplicar el mismo número en los dos sitios
 *    lo cobra dos veces y deja la cotización por debajo del piso sin que se note.
 *  · Los administrativos se reparten proporcionalmente al costo de cada línea, así que
 *    aplicarlos línea por línea da el mismo total que aplicarlos al gran total. Eso es
 *    lo que permite que una línea pueda marginar distinto sin romper la suma.
 *
 * LEGADO: una línea sin costo (las cotizaciones anteriores a esto guardaban solo el
 * precio) conserva su `precio_venta` como precio de línea. Sin eso, recalcular una
 * cotización ya enviada la dejaría en cero.
 */

import {
  CONVENCION_MARGEN_POR_DEFECTO,
  costoUnitarioDelItem,
  precioConMargen,
  type ConvencionMargen,
} from './precio-item'

export interface ItemParaCascada {
  id?: string
  /** Ítem de cuadre de cotizaciones viejas: no tiene costo, su precio pasa derecho. */
  es_ajuste?: boolean | null
  cantidad?: number | null
  /** Costo unitario escrito a mano. */
  subtotal?: number | null
  numeroDeRubros: number
  /** Suma de `rubros.valor_total` cuando la línea se desglosa. */
  costoDeRubros?: number | null
  /** Descuento de COMPRA sobre el costo de la línea. */
  descuento_porcentaje?: number | null
  /** Margen propio de la línea. `null` usa el margen de la cotización. */
  margen_porcentaje?: number | null
  /** Precio guardado. Solo manda si la línea no tiene costo o se fijó a mano. */
  precio_venta?: number | null
  precio_manual?: boolean | null
}

export interface ParametrosCascada {
  /** Administración e imprevistos, en % sobre el costo directo. */
  administrativosPct?: number | null
  /** Margen de la cotización, el que aplica a toda línea que no traiga el suyo. */
  margenPct?: number | null
  /** Descuento comercial final, en % sobre la venta bruta. */
  descuentoComercialPct?: number | null
  convencionMargen?: ConvencionMargen | null
}

export interface LineaCalculada {
  id?: string
  /** Costo unitario, venga de rubros o escrito a mano. */
  costoUnitario: number
  /** Costo de la línea ya con cantidad y descuento de compra. */
  costoLinea: number
  /** Margen que se le aplicó, sea el propio o el de la cotización. */
  margenAplicado: number
  /** `true` si la línea trae margen propio distinto al de la cotización. */
  margenPropio: boolean
  /** Precio de la línea, ya con administrativos y margen. */
  precioLinea: number
}

export interface Cascada {
  lineas: LineaCalculada[]
  costoDirecto: number
  administrativos: number
  costoDeVenta: number
  ventaBruta: number
  descuentoComercial: number
  precioVenta: number
  /**
   * Margen real de la cotización: lo que queda después de pagar TODO el costo,
   * administrativos incluidos. `null` sin precio, porque un 0 se leería como
   * "vendido a costo" y es otra cosa.
   */
  margenRealPct: number | null
}

/** Costo de una línea: unitario × cantidad, menos el descuento de compra. */
export function costoDeLinea(item: ItemParaCascada): number {
  if (item.es_ajuste === true) return 0
  const unitario = costoUnitarioDelItem({
    numeroDeRubros: item.numeroDeRubros,
    costoDeRubros: item.costoDeRubros,
    subtotal: item.subtotal,
  })
  const cantidad = Number(item.cantidad) || 1
  const descuento = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
  return unitario * cantidad * (1 - descuento / 100)
}

/** Toda la cascada, de las líneas al precio final. */
export function calcularCascada(items: ItemParaCascada[], params: ParametrosCascada): Cascada {
  const adminPct = Math.max(0, Number(params.administrativosPct) || 0)
  const margenCotizacion = Number(params.margenPct) || 0
  const descComercial = Math.min(100, Math.max(0, Number(params.descuentoComercialPct) || 0))
  const convencion = params.convencionMargen ?? CONVENCION_MARGEN_POR_DEFECTO

  const lineas: LineaCalculada[] = []
  let costoDirecto = 0
  let ventaBruta = 0

  for (const item of items) {
    const costoUnitario = item.es_ajuste === true
      ? 0
      : costoUnitarioDelItem({
        numeroDeRubros: item.numeroDeRubros,
        costoDeRubros: item.costoDeRubros,
        subtotal: item.subtotal,
      })
    const costoLinea = costoDeLinea(item)
    costoDirecto += costoLinea

    const margenPropio = item.margen_porcentaje !== null && item.margen_porcentaje !== undefined
    const margenAplicado = margenPropio ? Number(item.margen_porcentaje) || 0 : margenCotizacion

    let precioLinea: number
    if (costoLinea <= 0 || item.precio_manual === true || item.es_ajuste === true) {
      // Línea sin costo o con precio fijado a mano: manda lo guardado.
      const cantidad = Number(item.cantidad) || 1
      const descuento = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
      const bruto = (Number(item.precio_venta) || 0) * cantidad
      precioLinea = item.precio_manual === true || item.es_ajuste === true
        ? bruto
        : bruto * (1 - descuento / 100)
    } else {
      precioLinea = precioConMargen(costoLinea * (1 + adminPct / 100), margenAplicado, convencion)
    }

    ventaBruta += precioLinea
    lineas.push({
      id: item.id,
      costoUnitario,
      costoLinea: Math.round(costoLinea),
      margenAplicado,
      margenPropio,
      precioLinea: Math.round(precioLinea),
    })
  }

  const administrativos = costoDirecto * (adminPct / 100)
  const costoDeVenta = costoDirecto + administrativos
  const descuentoComercial = ventaBruta * (descComercial / 100)
  const precioVenta = ventaBruta - descuentoComercial

  return {
    lineas,
    costoDirecto: Math.round(costoDirecto),
    administrativos: Math.round(administrativos),
    costoDeVenta: Math.round(costoDeVenta),
    ventaBruta: Math.round(ventaBruta),
    descuentoComercial: Math.round(descuentoComercial),
    precioVenta: Math.round(precioVenta),
    margenRealPct: precioVenta > 0 ? ((precioVenta - costoDeVenta) / precioVenta) * 100 : null,
  }
}
