import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Memo por petición para las RUTAS (`route.ts`), donde el `cache()` de React no memoiza.
 *
 * `getWorkspace` va envuelto en `cache()` para no repetir la sesión (Auth + profile + staff +
 * staff_areas) dentro de un mismo render. En una ruta no hay render: el `cache()` de React sin
 * despachador llama a la función cada vez (`react.react-server`: `if (!dispatcher) return
 * fn.apply(...)`). Medido el 2026-10-01 con el doble de la base: «Aceptar» de la bandeja de
 * Trappvel resolvía la sesión CINCO veces en serie (brief del 2026-10-01, punto 3), cada una con
 * su viaje a Supabase Auth y tres consultas.
 *
 * Opt-in: solo memoiza dentro de `enPeticionDeRuta(...)`. Fuera de ella, `memoDeRuta(fn)` es
 * `fn` tal cual, así que ninguna otra ruta, acción ni página cambia.
 */
const almacen = new AsyncLocalStorage<Map<unknown, unknown>>()

/** Corre `fn` con su propio memo: lo memoizado vive lo que dura esta petición. */
export function enPeticionDeRuta<T>(fn: () => Promise<T>): Promise<T> {
  return almacen.run(new Map(), fn)
}

/**
 * `fn` (sin argumentos) memoizada dentro de `enPeticionDeRuta`. Guarda la promesa: dos
 * llamadas a la vez comparten el mismo viaje.
 */
export function memoDeRuta<R>(fn: () => R): () => R {
  return () => {
    const memo = almacen.getStore()
    if (!memo) return fn()
    if (!memo.has(fn)) memo.set(fn, fn())
    return memo.get(fn) as R
  }
}
