/**
 * Referencia de un pago que NO entró por la pasarela (consignación, comprobante).
 *
 * `cobros.external_ref` es la llave del registro de pagos y del control de duplicados
 * (`refDuplicadaNoSplit`): no puede quedar vacía y NO puede confundirse con una
 * referencia real de ePayco (que siempre es numérica pura, `String(ref_payco)`).
 *
 * Por eso la referencia que escribe el área financiera vive en su propio espacio de
 * nombres, con prefijo `EXT-`:
 *   - Un comprobante NUNCA puede hacerse pasar por una referencia de ePayco.
 *   - Sigue contando para el control de duplicados: teclear dos veces el mismo
 *     comprobante queda detectado (casi siempre es un error de digitación).
 *
 * Módulo puro (sin `'use server'`): lo usan el server action y el render.
 */

/** Espacio de nombres de las referencias escritas a mano para pagos fuera de ePayco. */
export const PREFIJO_REF_EXTERNA = 'EXT-'

/** Prefijo de la referencia interna autogenerada cuando no se escribe ninguna. */
export const PREFIJO_REF_AUTOGENERADA = 'FUERA-EPAYCO-'

/** Largo máximo de la parte legible (lo que teclea la financiera). */
export const MAX_LARGO_REF_EXTERNA = 40

/**
 * Normaliza lo que escribió la persona: recorta, colapsa espacios internos, pasa a
 * mayúsculas y quita el prefijo `EXT-` si lo tecleó a mano (evita `EXT-EXT-...`).
 * Devuelve `null` cuando queda vacío — el caller decide el fallback.
 */
export function normalizarRefExterna(raw: string | null | undefined): string | null {
  const base = (raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (!base) return null
  const sinPrefijo = base.startsWith(PREFIJO_REF_EXTERNA) ? base.slice(PREFIJO_REF_EXTERNA.length).trim() : base
  return sinPrefijo || null
}

/**
 * Arma el `external_ref` definitivo a partir de lo que escribió la financiera.
 * `null` si no escribió nada (el caller cae a la referencia autogenerada).
 */
export function construirRefExterna(raw: string | null | undefined): string | null {
  const normalizada = normalizarRefExterna(raw)
  return normalizada ? `${PREFIJO_REF_EXTERNA}${normalizada}` : null
}

/** ¿Este `external_ref` es una referencia escrita a mano (fuera de ePayco)? */
export function esRefExterna(ref: string | null | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith(PREFIJO_REF_EXTERNA)
}

/**
 * Texto legible de un `external_ref` para la UI: a la referencia escrita a mano se le
 * quita el prefijo interno (`EXT-9912345` → `9912345`). Cualquier otra referencia
 * (ePayco, autogenerada) se muestra tal cual.
 */
export function referenciaVisible(ref: string | null | undefined): string {
  if (!ref) return ''
  return esRefExterna(ref) ? ref.slice(PREFIJO_REF_EXTERNA.length) : ref
}
