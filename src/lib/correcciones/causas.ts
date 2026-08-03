/**
 * Vocabulario de causas de corrección. Módulo puro (sin `server-only`) porque lo
 * comparten el registro en el servidor y el selector en el navegador: una sola
 * definición, o las etiquetas de la pantalla y las de la base se separan.
 *
 * Las tres opciones existen para distinguir el error real del cambio legítimo. Sin
 * esa distinción, el agregado por área contaría como falla a un cliente que cambió
 * de idea.
 */

export type CausaCorreccion = 'error_captura' | 'cambio_cliente' | 'dato_posterior'

export const CAUSAS_CORRECCION: CausaCorreccion[] = ['error_captura', 'cambio_cliente', 'dato_posterior']

/** Texto corto para el registro y el timeline. */
export const LABEL_CAUSA: Record<CausaCorreccion, string> = {
  error_captura: 'error de captura',
  cambio_cliente: 'cambio del cliente',
  dato_posterior: 'el dato llegó después',
}

/** Texto del botón: se lee como respuesta a "¿por qué se corrige?". */
export const OPCION_CAUSA: Record<CausaCorreccion, string> = {
  error_captura: 'Se digitó mal',
  cambio_cliente: 'El cliente cambió',
  dato_posterior: 'El dato llegó después',
}

export function esCausaValida(v: unknown): v is CausaCorreccion {
  return typeof v === 'string' && (CAUSAS_CORRECCION as string[]).includes(v)
}

/**
 * Agrupa los campos tocados en un mismo acto de corrección. Lo genera el navegador:
 * solo agrupa, no autoriza nada. `crypto.randomUUID` no existe en contextos sin
 * https, de ahí el respaldo.
 */
export function nuevaSesionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}
