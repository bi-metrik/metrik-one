/**
 * Qué pasa con una captura de la bandeja después de tocar «Aceptar» (R1, reunión con Edgar y
 * Alejandra del 2026-09-23).
 *
 * Regla de Mauricio: un faltante de la tarifa por pasajero (la captura de solo adultos, la
 * moneda, la tasa) NUNCA impide aceptar. La opción se acepta con lo leído y el faltante queda
 * pendiente en su bloque, que ya lo muestra como «Requiere atención» y ya impide enviar la
 * cotización sin costo (#868). Lo único que frena es lo que de verdad impide tocar la opción:
 * sin sesión, opción inexistente, cotización cerrada, o un fallo al guardar.
 */

export interface RespuestaAceptar {
  success: boolean
  error?: string | null
  codigo?: 'CONTEXTO' | 'PENDIENTE' | 'ERROR' | null
}

export type Desenlace =
  | { tipo: 'aceptada' }
  | { tipo: 'pendiente'; mensaje: string }
  | { tipo: 'error'; mensaje: string }

const SIN_RESPUESTA = 'No se pudo aceptar: no hubo respuesta. Vuelve a intentarlo.'

export function desenlaceDeAceptar(r: RespuestaAceptar | null | undefined): Desenlace {
  if (!r || typeof r.success !== 'boolean') return { tipo: 'error', mensaje: SIN_RESPUESTA }
  if (r.success) return { tipo: 'aceptada' }
  if (r.codigo === 'PENDIENTE') {
    return { tipo: 'pendiente', mensaje: `Aceptada. Queda pendiente en su bloque: ${r.error ?? 'falta un dato de la tarifa'}` }
  }
  return { tipo: 'error', mensaje: r.error || SIN_RESPUESTA }
}
