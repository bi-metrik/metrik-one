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

// ── Esquema de tarifas por plan y ruta: aprobación manual fuera de la tarifa ──
//
// Antes de las tarifas (#977, 2026-10-01) el tope del bloque en SOENA era 100 % y el
// umbral 50 %: el comercial emitía cualquier descuento y uno sobre el 50 % lo aprobaba
// solo un rol gerencial (gate del 2026-06-04). Con las tarifas el tope pasó a ser el de
// la versión (25 %) y se volvió un muro para TODOS al generar, con lo que el umbral (50)
// quedó mudo y nadie podía aprobar un precio distinto (SOE-004, V0570). Además el gate
// nunca admitió recargos: un precio por encima de la base se rechazaba incluso al dueño.
//
// Regla de hoy, solo con tarifas: el comercial escribe cualquier valor por plan y la
// propuesta se genera. Si el valor queda FUERA de la tarifa —más descuento que el tope,
// o por encima del valor de la casilla— solo la aprueba un owner/admin/supervisor, y con
// un motivo escrito que queda en el bloque y en la historia del negocio. Dentro de la
// tarifa todo sigue como antes (incluido el umbral, si alguna vez queda por debajo del tope).

/** Un descuento fuera de la tarifa: recargo (negativo) o más descuento que el tope. */
export function fueraDeTarifa(descuentoPct: number | null | undefined, cap: number): boolean {
  if (descuentoPct == null || !Number.isFinite(descuentoPct)) return false
  return descuentoPct < 0 || (Number.isFinite(cap) && descuentoPct > cap)
}

/** «31,87 % por encima de la tarifa» / «30 % de descuento, el tope es 25 %». */
export function describirFueraDeTarifa(descuentoPct: number, cap: number): string {
  return descuentoPct < 0
    ? `${redondear(-descuentoPct)}% por encima de la tarifa`
    : `${redondear(descuentoPct)}% de descuento, el tope es ${cap}%`
}

/**
 * Motivo por el que NO se puede aprobar (o corregir) este valor con tarifas, o `null`.
 * `motivo` es lo que escribió quien aprueba: fuera de la tarifa es obligatorio.
 */
export function motivoAprobacionTarifaRechazada(
  e: EntradaGateDescuento & { motivo?: string | null },
): string | null {
  const d = e.descuentoPct
  if (d == null || !Number.isFinite(d)) return null
  if (fueraDeTarifa(d, e.cap)) {
    if (!ROLES_DESCUENTO_ALTO.includes(e.role ?? '')) {
      return `${e.etiqueta} queda fuera de la tarifa (${describirFueraDeTarifa(d, e.cap)}) y solo lo aprueba un supervisor, administrador o dueño.`
    }
    if (!(e.motivo ?? '').trim()) {
      return `${e.etiqueta} queda fuera de la tarifa (${describirFueraDeTarifa(d, e.cap)}): escribe el motivo de la aprobación.`
    }
    return null
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

/** Lo que el bloque guarda cuando se aprueba un valor fuera de la tarifa. */
export interface AprobacionFueraDeTarifa {
  motivo: string
  /** Descuento del plan aprobado sobre su casilla (negativo = recargo). */
  descuento_pct: number
  /** Valor de la casilla plan × ruta (la tarifa). */
  base: number
  cap: number
}

/** Tope del motivo guardado: es texto libre de una persona, no un documento. */
export const MOTIVO_MAX = 500
