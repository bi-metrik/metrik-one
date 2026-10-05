/**
 * Lo que `recalcularTotales` escribe en UNA línea después de correr la cascada, o `null` si la
 * línea ya dice eso (brief del 2026-10-05, punto 13).
 *
 * Hasta ese día el recálculo escribía todas las líneas, en serie, en cada cambio: con 12 líneas,
 * 12 viajes a la base aunque solo una hubiera cambiado. «Aceptar» de la bandeja recalcula, y se
 * medía en 1,3–3,5 s. Lo que se escribe no cambia; cambia que una línea igual no se reescribe.
 *
 * Las comparaciones son al centavo (costo) y al peso (precio): son las cifras que guarda la base.
 *
 * Puro.
 */

export interface FilaParaRecalculo {
  cantidad?: number | string | null
  subtotal?: number | string | null
  precio_venta?: number | string | null
  precio_manual?: boolean | null
}

export interface LineaRecalculada {
  costoUnitario: number
  costoLinea: number
  precioLinea: number
}

const centavos = (v: unknown) => Math.round((Number(v) || 0) * 100)

export function patchDeRecalculo(
  fila: FilaParaRecalculo,
  linea: LineaRecalculada,
  /** La línea tiene precios de fila escritos a mano en la tarjeta (`precioDeLineaConManuales`). */
  conManuales: boolean,
): Record<string, unknown> | null {
  // `items.precio_venta` es UNITARIO: la plantilla del PDF lo multiplica por la cantidad.
  // Guardar aquí el total de la línea la duplicaría en el documento.
  const cantidad = Number(fila.cantidad) || 1
  const patch: Record<string, unknown> = { subtotal: linea.costoUnitario }
  if (linea.costoLinea > 0 && fila.precio_manual !== true) {
    patch.precio_venta = Math.round(linea.precioLinea / cantidad)
  }
  // Precios de fila a mano: el precio de la línea es el que acaba de calcularse.
  if (conManuales) {
    patch.precio_venta = Math.round(linea.precioLinea / cantidad)
    patch.precio_manual = true
  }
  const igual =
    // Un costo ausente (fila a medio armar) se escribe: no se da por igual a un cero.
    fila.subtotal !== null && fila.subtotal !== undefined
    && centavos(fila.subtotal) === centavos(patch.subtotal)
    && (patch.precio_venta === undefined || Math.round(Number(fila.precio_venta) || 0) === patch.precio_venta)
    && (patch.precio_manual === undefined || fila.precio_manual === true)
  return igual ? null : patch
}
