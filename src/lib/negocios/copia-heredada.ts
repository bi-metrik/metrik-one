/**
 * Copia heredada de un documento: ¿se puede escribir desde ella, y en qué fila?
 *
 * Una config con `source_etapa_orden` es una COPIA del bloque de esa etapa de origen. La ficha
 * le pinta el `data` del origen (herencia readonly de documento en `getNegocioDetalle`), así
 * que escribir en la fila propia de la copia falla en silencio: la corrección desaparece al
 * recargar, y la copia no tiene `slug`, así que tampoco llega a quien lee por slug.
 *
 * Por eso hay solo dos salidas, y este módulo es el ÚNICO criterio que las decide, para la
 * pantalla (`getBloqueMode`, `BloqueDocumento`) y para el servidor (`documento-actions`):
 *
 *   - la copia declara `editable_siempre` y el slug de su origen → se escribe en la fila del
 *     ORIGEN (`casilla-compartida.resolverDestino`), y la copia lo refleja sola;
 *   - cualquier otra copia → solo lectura. La pantalla no ofrece subir ni corregir, y el
 *     servidor lo rechaza con el mismo criterio.
 *
 * Caso que lo obliga (SOENA, 2026-10-05): «Factura emitida» vive en Cargue (orden 7) y se
 * repite como copia en las 12 etapas siguientes con `editable_siempre`, para cargar la factura
 * que se hizo por fuera de ONE desde donde esté el caso. La pantalla dejaba subir y el
 * servidor la rechazaba al final («Este bloque es una copia de solo lectura…»).
 *
 * Puro: lo importan el cliente y el servidor.
 */

export type ConfigExtra = Record<string, unknown>

/** ¿Esta config es una copia heredada de otra etapa? */
export function esCopiaHeredada(configExtra: ConfigExtra | null | undefined): boolean {
  return typeof (configExtra ?? {}).source_etapa_orden === 'number'
}

/**
 * Slug del origen al que escribe esta copia heredada, o null si la copia no escribe.
 *
 * Exige las dos mitades, estrictas: el flag `editable_siempre === true` (el bloque declara que
 * su documento puede llegar después de su etapa) y el slug del origen (sin él no hay a dónde
 * escribir, y adivinar el destino de un documento es peor que no dejar subirlo).
 */
export function origenDeCopiaEscribible(configExtra: ConfigExtra | null | undefined): string | null {
  const ce = configExtra ?? {}
  if (!esCopiaHeredada(ce)) return null
  if (ce.editable_siempre !== true) return null
  const slug = ce.source_bloque_slug
  return typeof slug === 'string' && slug.length > 0 ? slug : null
}

/** ¿Copia heredada desde la que NO se puede escribir? (pantalla y servidor, mismo criterio) */
export function copiaDeSoloLectura(configExtra: ConfigExtra | null | undefined): boolean {
  return esCopiaHeredada(configExtra) && origenDeCopiaEscribible(configExtra) === null
}

/** Mensaje del rechazo, apuntando a la etapa de origen. */
export function mensajeCopiaDeSoloLectura(configExtra: ConfigExtra | null | undefined): string {
  const orden = (configExtra ?? {}).source_etapa_orden
  return `Este bloque es una copia de solo lectura de la etapa ${String(orden)}. Corrige el documento en su etapa de origen.`
}

/** Mensaje cuando la copia sí escribe en su origen pero la fila del origen no se pudo resolver. */
export const MENSAJE_ORIGEN_NO_RESUELTO =
  'No se encontró la casilla de origen de este documento, así que no se guardó nada. Avisa a soporte.'
