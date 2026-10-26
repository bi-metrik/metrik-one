// ============================================================
// LATENCIA SIMULADA sobre el doble de igualdad (`igualdad-servidor-doble.ts`), para medir en
// local lo que en producción cuesta cada ida a la base (V1, V2 y V4 de la verificación D).
//
// El doble responde al instante, así que solo sabe CONTAR idas. En producción cada ida es un
// viaje de Vercel a Supabase (≈ 20–30 ms, medido en el `Server-Timing` de Vera: `contexto` con
// dos idas en 50–70 ms). Con este envoltorio cada ida espera `ms` antes de responder, y las que
// van en paralelo (`Promise.all`) se solapan como en la red: el tiempo de pared dice cuántas idas
// van EN SERIE, que es lo que el usuario espera.
//
// No toca el doble ni su registro: el presupuesto de idas de C0 sigue contando lo mismo.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

const estado = { ms: 0 }

/** La espera de cada ida, en milisegundos. `0` = el doble de siempre. */
export function ponerLatencia(ms: number) {
  estado.ms = ms
}

const dormir = () => (estado.ms > 0 ? new Promise<void>(r => setTimeout(r, estado.ms)) : Promise.resolve())

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cualquiera = any

function esConstructor(v: unknown): boolean {
  return !!v && typeof v === 'object' && typeof (v as { eq?: unknown }).eq === 'function'
}

function demorado(objetivo: Cualquiera): Cualquiera {
  return new Proxy(objetivo, {
    get(o, prop) {
      const v = o[prop]
      if (prop === 'then') {
        return (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => dormir().then(() => v.call(o, res, rej))
      }
      if (prop === 'single' || prop === 'maybeSingle') return () => dormir().then(() => v.call(o))
      if (typeof v === 'function') {
        return (...args: unknown[]) => {
          const r = v.apply(o, args)
          return esConstructor(r) ? demorado(r) : r
        }
      }
      return v
    },
  })
}

/** El cliente del doble con la latencia de `ponerLatencia` en cada ida. */
export function conLatencia<T extends { from: (t: string) => unknown; rpc: (...a: Cualquiera[]) => Promise<unknown> }>(cliente: T): T {
  return {
    ...cliente,
    from: (t: string) => demorado(cliente.from(t)),
    rpc: async (...a: Cualquiera[]) => {
      await dormir()
      return cliente.rpc(...a)
    },
  }
}
