/**
 * Precio de venta de un ítem de cotización.
 *
 * Un ítem se puede cotizar de dos maneras y el sistema tiene que saber cuál manda:
 *
 *  · POR RUBROS  — el ítem tiene costos desglosados y el precio se DERIVA:
 *                  costo de rubros + margen %. Es el caso que quedaba en cero,
 *                  porque la suma de rubros solo se escribía en `subtotal` (costo)
 *                  y la fila / el total / el PDF muestran `precio_venta`.
 *  · A MANO      — alguien escribió el valor unitario. `precio_manual = true` y el
 *                  sistema no lo vuelve a tocar.
 *
 * El ítem de ajuste (`es_ajuste`) nunca entra aquí: lo gestiona la reconciliación.
 */

export interface ItemParaPrecio {
  es_ajuste?: boolean | null
  precio_venta?: number | null
  margen_porcentaje?: number | null
  precio_manual?: boolean | null
  /** Cantidad de rubros del ítem. El costo unitario ya viene en `subtotal`. */
  numeroDeRubros: number
  /** Costo unitario del ítem = suma de `rubros.valor_total`. */
  subtotal: number
}

/**
 * ¿El precio de este ítem lo deriva el sistema desde sus rubros?
 *
 * Solo si NO es el ítem de ajuste, tiene al menos un rubro, y nadie sobreescribió
 * el precio a mano. Cualquier otro caso conserva el comportamiento previo al fix.
 */
export function precioSeDerivaDeRubros(item: ItemParaPrecio): boolean {
  if (item.es_ajuste === true) return false
  if (item.numeroDeRubros <= 0) return false
  return item.precio_manual !== true
}

/**
 * Precio de venta UNITARIO que le corresponde al ítem.
 *
 * Devuelve el precio derivado cuando aplica, y el precio guardado cuando no.
 * Un margen ausente o inválido vale 0 — el precio queda igual al costo, que es la
 * lectura honesta de "no le he puesto margen todavía", no un ítem en cero.
 */
export function precioVentaDelItem(item: ItemParaPrecio): number {
  if (!precioSeDerivaDeRubros(item)) return Number(item.precio_venta) || 0
  const margen = Number(item.margen_porcentaje)
  const margenValido = Number.isFinite(margen) ? margen : 0
  const subtotal = Number(item.subtotal) || 0
  return Math.round(subtotal * (1 + margenValido / 100))
}
