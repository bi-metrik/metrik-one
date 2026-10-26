// ============================================================
// Doble del almacén de caché de Next (el `incrementalCache` que usa `unstable_cache`).
//
// Permite ejercitar el `unstable_cache` REAL de Next 16.1.6 en vitest: la llave la arma
// Next, no la prueba. Guarda por llave, borra por tag y marca vencida una entrada pasada
// su `revalidate`, como el Data Cache de Vercel.
//
// ⚠️ Se importa ANTES que cualquier módulo que cargue `next/cache`: Next lee
// `globalThis.AsyncLocalStorage` al cargar sus módulos, y vitest no lo instala.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================
import { AsyncLocalStorage } from 'node:async_hooks'

;(globalThis as unknown as { AsyncLocalStorage: unknown }).AsyncLocalStorage = AsyncLocalStorage

type Entrada = { body: string; tags: string[]; lastModified: number; revalidate: number }

export const almacen = new Map<string, Entrada>()

export const cacheIncremental = {
  isOnDemandRevalidate: false,
  async generateCacheKey(invocationKey: string) {
    return invocationKey
  },
  async get(key: string) {
    const e = almacen.get(key)
    if (!e) return null
    const edad = (Date.now() - e.lastModified) / 1000
    return {
      isStale: edad > e.revalidate,
      value: { kind: 'FETCH', data: { headers: {}, body: e.body, status: 200, url: '' }, revalidate: e.revalidate },
    }
  },
  async set(
    key: string,
    data: { data: { body: string }; revalidate: number },
    ctx: { tags?: string[] },
  ) {
    almacen.set(key, {
      body: data.data.body,
      tags: ctx.tags ?? [],
      lastModified: Date.now(),
      revalidate: data.revalidate,
    })
  },
  /** Lo que hace `updateTag` en producción: vence toda entrada con ese tag. */
  revalidarTag(tag: string) {
    for (const [k, e] of almacen) if (e.tags.includes(tag)) almacen.delete(k)
  },
}

;(globalThis as unknown as { __incrementalCache: unknown }).__incrementalCache = cacheIncremental
