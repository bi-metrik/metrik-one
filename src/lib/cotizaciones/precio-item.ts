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

// ── Costo unitario del ítem ───────────────────────────────────────────────────

/** Lo mínimo que hace falta para saber cuánto cuesta un ítem. */
export interface ItemParaCosto {
  /** Cantidad de rubros del ítem. Con al menos uno, el costo lo mandan ellos. */
  numeroDeRubros: number
  /** Suma de `rubros.valor_total` cuando hay rubros. */
  costoDeRubros?: number | null
  /** `items.subtotal`: el costo escrito a mano del ítem que no se desglosa. */
  subtotal?: number | null
}

/**
 * Costo UNITARIO del ítem, venga de donde venga.
 *
 * Un ítem se puede costear de dos maneras, y como con el precio, el sistema tiene que
 * saber cuál manda:
 *
 *  · POR RUBROS — el costo es la suma de los rubros. Un `subtotal` escrito a mano se
 *                 ignora: dos costos para el mismo ítem terminan con el recálculo
 *                 pisando uno de los dos sin que nadie lo note.
 *  · A MANO     — el ítem no se desglosa (una bomba es una factura del proveedor) y su
 *                 costo vive en `subtotal`. Antes se pisaba con 0 en cada recálculo, así
 *                 que `cotizaciones.costo_total` quedaba en cero y la etapa de Ejecución
 *                 se quedaba sin presupuesto contra el cual medir el sobrecosto.
 *
 * `calcularPresupuestoPorRubro` ya cuenta el costo sin desglose como rubro "otro", así
 * que esta vía no deja huecos aguas abajo.
 */
export function costoUnitarioDelItem(item: ItemParaCosto): number {
  if (item.numeroDeRubros > 0) return Number(item.costoDeRubros) || 0
  return Number(item.subtotal) || 0
}
