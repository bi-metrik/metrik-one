/**
 * Confianza de los campos de un documento: qué está protegido (lo tocó una persona) y cómo
 * se baja un campo a «Verificar». Lo usan las normalizaciones del servidor y la pantalla.
 */

import type { CampoResultado } from '@/lib/ai/extract-fields'

/**
 * Confianza de un campo que una persona tiene que mirar.
 *
 * Cae en la banda "Verificar" de la pantalla (0.70 a 0.89, en ámbar) a propósito, y no
 * por debajo de 0.70: los formularios DIAN descartan como FALTANTE todo campo bajo ese
 * umbral (`resolverCamposFuente`). Un NIT dudoso bloquearía el 1668 de cada cliente de
 * Bancolombia, cuyo NIT es justo el caso ambiguo. Se quiere que la persona lo vea, no
 * frenar el trámite.
 */
export const CONFIANZA_REVISAR = 0.75

/**
 * ¿Lo tocó una persona? Uno con `edicion`, o con `manual: true` y valor (eso solo existe
 * después del merge de `reprocesarDocumento`; ver el encabezado de `normalizaciones.ts`).
 */
export function campoProtegido(c: CampoResultado | undefined | null): boolean {
  if (!c) return false
  if (c.edicion) return true
  return c.manual === true && c.value != null && c.value !== ''
}

/**
 * Baja a "Verificar" sin quitar el valor. No hace falta un piso de 0.70: a esta
 * función solo llegan campos NO protegidos con valor, y esos salen de una extracción
 * fresca, donde todo valor bajo 0.70 ya se forzó a null (`extract-fields.ts`).
 * Medido por mutación el 2026-09-14: un piso explícito no cambiaba ningún resultado.
 */
export function bajarConfianza(c: CampoResultado): void {
  c.confidence = Math.min(c.confidence, CONFIANZA_REVISAR)
  c.manual = false
}
