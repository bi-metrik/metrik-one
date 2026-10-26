import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Cuánto tarda cada etapa de una ruta, para el encabezado `Server-Timing` (brief del
 * 2026-10-05, punto 13: «Aceptar» de la bandeja tardaba 1,3–3,5 s y no se sabía en qué).
 *
 * Opt-in, igual que `memo-de-ruta.ts`: solo mide dentro de `conTiempos(...)`. Fuera de ella,
 * `medirEtapa(nombre, fn)` es `fn()` tal cual. Las etapas que se repiten se suman.
 */
const almacen = new AsyncLocalStorage<Map<string, number>>()

/** Corre `fn` midiendo sus etapas; devuelve el resultado y las etapas en orden de llegada. */
export async function conTiempos<T>(fn: () => Promise<T>): Promise<{ resultado: T; etapas: [string, number][] }> {
  const etapas = new Map<string, number>()
  const resultado = await almacen.run(etapas, fn)
  return { resultado, etapas: [...etapas.entries()] }
}

/** Mide una etapa. Sin `conTiempos` alrededor no mide nada. */
export async function medirEtapa<T>(nombre: string, fn: () => Promise<T>): Promise<T> {
  const etapas = almacen.getStore()
  if (!etapas) return fn()
  const inicio = performance.now()
  try {
    return await fn()
  } finally {
    etapas.set(nombre, (etapas.get(nombre) ?? 0) + (performance.now() - inicio))
  }
}

/** `aceptar;dur=1840, contexto;dur=210, …`: lo que se manda en `Server-Timing`. */
export function encabezadoServerTiming(total: [string, number], etapas: readonly [string, number][]): string {
  return [total, ...etapas].map(([n, ms]) => `${n};dur=${Math.round(ms)}`).join(', ')
}
