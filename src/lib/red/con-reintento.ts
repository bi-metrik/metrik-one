import { esErrorDeRed } from './error-de-red'

/**
 * Corre `fn` y, si falla por RED, la reintenta una vez tras una pausa corta.
 *
 * ⚠️ Solo para LECTURAS (o escrituras idempotentes). Un `Load failed` no dice si la
 * peticion alcanzo al servidor: en iOS sale tambien cuando la respuesta se pierde al
 * mandar la app al fondo. Reintentar una escritura no idempotente puede aplicarla dos
 * veces (un pago, una marca, un comentario). Las escrituras van por
 * `useTransitionTolerante`, que avisa y deja que la persona decida.
 *
 * Un error que no es de red se relanza tal cual en el primer intento.
 */
export async function conReintentoDeRed<T>(
  fn: () => Promise<T>,
  opciones: { esperaMs?: number; dormir?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const { esperaMs = 800, dormir = (ms) => new Promise<void>((r) => setTimeout(r, ms)) } = opciones
  try {
    return await fn()
  } catch (e) {
    if (!esErrorDeRed(e)) throw e
    await dormir(esperaMs)
    return fn()
  }
}
