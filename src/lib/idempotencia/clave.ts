/**
 * La clave de una intención del usuario: una por clic o por envío de formulario.
 *
 * La genera el navegador (`useIntencion`) y la reutiliza en cualquier reintento de ESA misma
 * intención, incluido el «Reintentar» de «No se confirmó» y el POST que Chromium repite solo.
 * El servidor la combina con la acción, la persona y la huella de los argumentos: la misma
 * clave con argumentos distintos (la persona corrigió algo y volvió a enviar) es otra
 * intención y se ejecuta.
 *
 * Puro: sin red ni base. Lo usan el navegador y el servidor.
 */

/** Forma aceptada. Lo demás se ignora (la acción corre sin protección, como antes). */
const FORMA = /^[A-Za-z0-9_-]{8,64}$/

export function claveValida(clave: unknown): clave is string {
  return typeof clave === 'string' && FORMA.test(clave)
}

/** Una clave nueva. `randomUUID` existe en todo contexto seguro (https y localhost). */
export function nuevaClave(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

/**
 * JSON estable: las llaves de los objetos en orden. Dos envíos con los mismos datos en otro
 * orden son la misma intención.
 */
export function jsonEstable(valor: unknown): string {
  if (valor === undefined) return 'null'
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null'
  if (Array.isArray(valor)) return `[${valor.map(jsonEstable).join(',')}]`
  const obj = valor as Record<string, unknown>
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonEstable(obj[k])}`)
    .join(',')}}`
}

/**
 * ¿El resultado de una acción dice que NO se hizo? Entonces no se guarda: un reintento con la
 * misma clave vuelve a ejecutar (un Siigo caído no puede quedar respondiendo error para siempre).
 * Cubre las tres formas del producto: `{ error }`, `{ ok: false }` y `{ success: false }`.
 */
export function resultadoEsFalla(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  if (o.ok === false || o.success === false) return true
  return typeof o.error === 'string' && o.error.length > 0
}
