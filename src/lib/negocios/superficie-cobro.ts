/**
 * ¿Este bloque es una superficie donde se CAPTURA dinero?
 *
 * Un bloque `datos` se vuelve superficie de captura por una bandera de su
 * `config_extra`, y hoy son cuatro. El dispatch del detalle usa esas mismas
 * banderas para elegir qué componente pinta, así que la lista vive aquí y no
 * escrita al lado: copiada en el servidor y en la pantalla se desincroniza el día
 * que aparezca una superficie nueva, y el síntoma sería un aviso que deja de
 * mostrarse sin que nadie lo note (misma familia que el guard con el catálogo de
 * status copiado a mano, 2026-08-03).
 *
 * Al agregar una superficie de captura nueva: agregar su bandera a
 * `BANDERAS_CAPTURA_COBRO` **y** su rama al dispatch de `negocio-detail-client`.
 */
export const BANDERAS_CAPTURA_COBRO = [
  'es_pagos_epayco',
  'es_pago_externo',
  'permite_pago_externo',
  'es_multi_pago',
] as const

export function esSuperficieDeCapturaDeCobro(
  configExtra: Record<string, unknown> | null | undefined,
): boolean {
  if (!configExtra) return false
  return BANDERAS_CAPTURA_COBRO.some(k => configExtra[k] === true)
}
