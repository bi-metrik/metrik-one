import { MAX_BYTES_REPORTE, MAX_COLA, MAX_EDAD_COLA_MS, MAX_REENVIOS } from './limites'

/**
 * Cola de reenvio de `[error-cliente]` en localStorage (bandeja de salida).
 *
 * El aviso de un error de red viaja por la misma red mala: hasta 2026-10-05 un reporte
 * que no llegaba se perdia, y la cuenta de errores era un piso. Ahora cada reporte se
 * anota ANTES de mandarlo y se borra cuando el servidor contesta. Lo que quede anotado
 * (no hubo respuesta, o la pagina se recargo antes) sale en la siguiente carga o al
 * volver `online`.
 *
 * Consecuencia buscada: puede llegar DOS veces (la respuesta se perdio pero el reporte
 * si llego). Por eso cada uno lleva un `id`: al contar en los logs, se cuenta por `id`
 * distinto, no por linea.
 *
 * Todo acceso al almacen va en try/catch: Safari privado, cuota llena o un almacen
 * deshabilitado no pueden romper la pantalla de error. Sin almacen, no hay cola y el
 * reporte sale una sola vez, como antes.
 */

/** Lo minimo de `Storage` que usa la cola (inyectable en las pruebas). */
export interface Almacen {
  getItem(clave: string): string | null
  setItem(clave: string, valor: string): void
  removeItem(clave: string): void
}

export interface ReporteEnCola {
  id: string
  /** Cuando se armo el reporte (epoch ms). */
  creado: number
  /** Veces que ya se reintento desde la cola. */
  reenvios: number
  cuerpo: Record<string, unknown>
}

export const CLAVE_COLA = 'metrik:errores-cliente:cola'

export function localStorageSeguro(): Almacen | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function esEntrada(x: unknown): x is ReporteEnCola {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    typeof e.creado === 'number' &&
    typeof e.reenvios === 'number' &&
    !!e.cuerpo &&
    typeof e.cuerpo === 'object'
  )
}

/** Lo que hay en la cola, ya sin lo vencido ni lo que se paso de reintentos. */
export function leerCola(almacen: Almacen | null, ahora: number): ReporteEnCola[] {
  if (!almacen) return []
  try {
    const crudo = almacen.getItem(CLAVE_COLA)
    if (!crudo) return []
    const lista: unknown = JSON.parse(crudo)
    if (!Array.isArray(lista)) return []
    return lista
      .filter(esEntrada)
      .filter((e) => ahora - e.creado <= MAX_EDAD_COLA_MS && e.creado <= ahora + 60_000)
      .filter((e) => e.reenvios < MAX_REENVIOS)
      .slice(-MAX_COLA)
  } catch {
    return []
  }
}

function escribirCola(almacen: Almacen, lista: ReporteEnCola[]): void {
  try {
    if (lista.length === 0) almacen.removeItem(CLAVE_COLA)
    else almacen.setItem(CLAVE_COLA, JSON.stringify(lista))
  } catch {
    // Cuota llena o almacen bloqueado: la cola es lo de menos.
  }
}

/** Anota un reporte. Si la cola se pasa del tope, sale el mas viejo. */
export function encolar(almacen: Almacen | null, entrada: ReporteEnCola, ahora: number): void {
  if (!almacen) return
  try {
    // Un reporte que no cabe en el endpoint tampoco se guarda: nunca llegaria.
    if (JSON.stringify(entrada.cuerpo).length > MAX_BYTES_REPORTE) return
    const lista = leerCola(almacen, ahora).filter((e) => e.id !== entrada.id)
    lista.push(entrada)
    escribirCola(almacen, lista.slice(-MAX_COLA))
  } catch {
    // Idem.
  }
}

export function quitarDeCola(almacen: Almacen | null, id: string, ahora: number): void {
  if (!almacen) return
  const lista = leerCola(almacen, ahora)
  const resto = lista.filter((e) => e.id !== id)
  if (resto.length !== lista.length) escribirCola(almacen, resto)
}

/** Suma un reintento a la entrada (la que llegue a `MAX_REENVIOS` sale en la proxima lectura). */
export function anotarReenvio(almacen: Almacen | null, id: string, ahora: number): void {
  if (!almacen) return
  const lista = leerCola(almacen, ahora)
  escribirCola(
    almacen,
    lista.map((e) => (e.id === id ? { ...e, reenvios: e.reenvios + 1 } : e)),
  )
}

/** Id corto, sin datos de la persona. `crypto.randomUUID` donde exista. */
export function nuevoId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // Contexto no seguro (http sin localhost): cae al de abajo.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
