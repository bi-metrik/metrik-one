import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Lo que NO cambia mientras se aceptan pantallazos de la forma por pasos (H2 y H3 de la
 * verificación D de Vera, 2026-10-14): el estado de la cotización (borrador) y quiénes viajan.
 *
 * «Aceptar los 11» releía la cotización y el viaje del negocio por cada pantallazo (`contexto` de
 * la aceptación, el nombre del bloque nuevo, el contexto de cada opción): con 25–35 ms por ida y
 * todo en serie, eran segundos de espera para leer once veces lo mismo. Ninguna aceptación escribe
 * en la cotización su estado ni en `negocio_bloques`, así que dentro de UNA aceptación (una o un
 * lote) basta leerlos una vez.
 *
 * Opt-in y con el contexto asíncrono de ESA petición (como `memo-de-ruta.ts` y
 * `recalculo-diferido.ts`): solo lo abren `aceptarPorPasos` y `aceptarLotePorPasos`, que exigen el
 * interruptor encendido. Fuera, `memoDeAceptacion(clave, fn)` es `fn()` tal cual: con el
 * interruptor apagado ONE hace exactamente las mismas idas que antes.
 *
 * Además, dentro de un lote, la ubicación de cada opción («Hotel en Providencia · Opción 2») se
 * calcula una vez al final y no releyendo todas las líneas tras cada pantallazo.
 */
interface Estado {
  memo: Map<string, Promise<unknown>>
  lote: boolean
}

const almacen = new AsyncLocalStorage<Estado>()

/** Corre `fn` con el memo de la aceptación. `lote`: además, la ubicación se calcula al final. */
export function conMemoDeAceptacion<T>(fn: () => Promise<T>, opciones: { lote?: boolean } = {}): Promise<T> {
  if (almacen.getStore()) return fn()
  return almacen.run({ memo: new Map(), lote: opciones.lote === true }, fn)
}

/**
 * `fn()` memoizada por `clave` dentro de la aceptación. Guarda la promesa: dos llamadas a la vez
 * comparten el viaje. Un resultado que falla no se guarda (la próxima lo reintenta).
 */
export function memoDeAceptacion<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const estado = almacen.getStore()
  if (!estado) return fn()
  const previa = estado.memo.get(clave) as Promise<T> | undefined
  if (previa) return previa
  const p = fn()
  estado.memo.set(clave, p)
  p.catch(() => estado.memo.delete(clave))
  return p
}

/** ¿Estamos dentro de un lote? Ahí la ubicación de cada opción se calcula al final. */
export function enLoteDeAceptacion(): boolean {
  return almacen.getStore()?.lote === true
}

// ── El orden de cada línea nueva en un lote (H3) ────────────────────────────

const ordenes = new AsyncLocalStorage<number>()

/** Corre `fn` diciendo con qué `orden` nace la línea que cree (la posición del pantallazo en el lote). */
export function conOrdenDeFila<T>(orden: number, fn: () => Promise<T>): Promise<T> {
  return ordenes.run(orden, fn)
}

/** El `orden` fijado para la línea que se crea ahora, o `null` fuera de un lote. */
export function ordenDeFila(): number | null {
  const o = ordenes.getStore()
  return typeof o === 'number' && Number.isFinite(o) ? o : null
}
