/**
 * El tope de descuento de la propuesta económica, en un solo lugar.
 *
 * Hay DOS puertas por las que se fija el honorario de un negocio, y hasta ahora solo
 * una evaluaba el tope:
 *
 *  1. `aprobarVersionPropuesta` — elegir plan sobre una versión generada. Valida el
 *     cap al generar y el umbral al aprobar.
 *  2. `corregirAprobacion` — escribir el honorario correcto sobre una aprobación ya
 *     hecha. Solo exigía "un número mayor que cero".
 *
 * El comentario de `revertirAprobacionPropuesta` declara que el cap no se puede saltar
 * "porque `aprobarVersionPropuesta` lo evalúa en CADA aprobación". La corrección era el
 * hueco de ese razonamiento: quien estuviera en `correccion_precio.staff_ids` podía
 * dejar el honorario en cualquier cifra sin pasar por el umbral que sí lo frena al
 * aprobar. Corregir un dato mal registrado y regalar un descuento se escriben igual en
 * la base; lo único que los separa es este gate.
 *
 * Puro: no toca DB ni red. Vive fuera del archivo `'use server'` a propósito — ahí todo
 * export tiene que ser async, y un helper sync exportado rompe el build del módulo.
 */

/** Roles que pueden aprobar un descuento por encima del umbral de la línea. */
export const ROLES_DESCUENTO_ALTO = ['owner', 'admin', 'supervisor']

/**
 * Descuento que un honorario implica contra la tarifa base con IVA.
 *
 * Devuelve `null` cuando no hay base contra la cual medir: sin ella no existe la noción
 * de descuento, y devolver 0 haría pasar cualquier cifra como "sin descuento".
 *
 * Conserva precisión (6 decimales, solo para matar ruido de float) por la misma razón
 * que `generarVersionPropuesta`: el precio tecleado manda y tiene que quedar exacto al
 * peso; el % es su lectura, no al revés.
 */
export function descuentoImplicito(honorario: number, precioBaseConIva: number): number | null {
  if (!Number.isFinite(precioBaseConIva) || precioBaseConIva <= 0) return null
  if (!Number.isFinite(honorario)) return null
  return Math.round((1 - honorario / precioBaseConIva) * 100 * 1e6) / 1e6
}

export interface EntradaGateDescuento {
  /** Descuento a evaluar, en puntos porcentuales (40 = 40%). */
  descuentoPct: number | null
  /** `config_extra.cap_descuento_pct` de la línea. */
  cap: number
  /** `config_extra.umbral_aprobacion_pct`. `null` = sin gate de rol. */
  umbral: number | null
  /** Rol del usuario en el workspace. */
  role: string | null | undefined
  /** Cómo nombrar lo evaluado en el mensaje ("Plan 1", "El valor corregido"). */
  etiqueta: string
}

/**
 * Motivo por el que este descuento NO puede fijarse, o `null` si puede.
 *
 * Devuelve el texto y no un booleano porque los dos rechazos son distintos para quien
 * los recibe: uno se arregla cambiando la cifra, el otro escalando a alguien con rol
 * gerencial. Un "no se puede" sin decir cuál de los dos manda a la persona a adivinar.
 *
 * Un descuento `null` (sin base contra la cual medirlo) NO se rechaza: frenar ahí sería
 * bloquear la corrección de un bloque viejo sin `precio_base_con_iva` por un dato que
 * falta en la configuración, no por una decisión de precio.
 */
export function motivoDescuentoRechazado(e: EntradaGateDescuento): string | null {
  const d = e.descuentoPct
  if (d == null || !Number.isFinite(d)) return null

  if (d < 0) {
    return `${e.etiqueta} queda por encima de la tarifa base — el descuento no puede ser negativo.`
  }
  if (Number.isFinite(e.cap) && d > e.cap) {
    return `${e.etiqueta}: ${redondear(d)}% de descuento supera el tope de la línea (${e.cap}%).`
  }
  if (e.umbral != null && d > e.umbral && !ROLES_DESCUENTO_ALTO.includes(e.role ?? '')) {
    return `${e.etiqueta}: ${redondear(d)}% de descuento supera ${e.umbral}% y requiere aprobación de un supervisor, administrador o dueño.`
  }
  return null
}

/** Redondeo a 2 decimales, solo para el mensaje (el valor almacenado no se toca). */
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}
