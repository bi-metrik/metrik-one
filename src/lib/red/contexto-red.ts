/**
 * Lo que el navegador sabe de su propia red en este momento, para los reportes que salen
 * a los logs (`[error-cliente]`, `[rum]`). SIN dependencias: corre en `error.tsx` y en
 * `global-error.tsx`, que tienen que cargar con la red que haya.
 *
 * `navigator.connection` (Network Information API) solo existe en Chrome/Android: en
 * Safari e iPhone no viene, y entonces `red` simplemente no va. Nunca lanza.
 */

export interface RedDelNavegador {
  /** `effectiveType`: 'slow-2g' | '2g' | '3g' | '4g'. Estimado por el navegador, no el plan. */
  tipo?: string
  /** Ida y vuelta estimada, en ms (el navegador la redondea a 25 ms). */
  rtt?: number
  /** Bajada estimada en Mbps (redondeada a 25 kbps). */
  bajadaMbps?: number
  /** La persona pidió ahorro de datos. */
  ahorroDatos?: boolean
}

export interface ContextoRed {
  red?: RedDelNavegador
  /** `navigator.onLine`. `false` es fiable; `true` solo dice que hay ALGUNA interfaz. */
  enLinea?: boolean
  /** Segundos desde que cargó la página (no desde la última navegación suave). */
  segDesdeCarga?: number
}

interface ConexionNavegador {
  effectiveType?: unknown
  rtt?: unknown
  downlink?: unknown
  saveData?: unknown
}

const numeroFinito = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined

export function leerRed(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator): RedDelNavegador | undefined {
  try {
    const c = (nav as { connection?: ConexionNavegador } | undefined)?.connection
    if (!c || typeof c !== 'object') return undefined
    const red: RedDelNavegador = {}
    if (typeof c.effectiveType === 'string' && c.effectiveType) red.tipo = c.effectiveType.slice(0, 10)
    const rtt = numeroFinito(c.rtt)
    if (rtt !== undefined) red.rtt = Math.round(rtt)
    const bajada = numeroFinito(c.downlink)
    if (bajada !== undefined) red.bajadaMbps = Math.round(bajada * 100) / 100
    if (typeof c.saveData === 'boolean') red.ahorroDatos = c.saveData
    return Object.keys(red).length > 0 ? red : undefined
  } catch {
    return undefined
  }
}

export function leerContextoRed(): ContextoRed {
  const ctx: ContextoRed = {}
  try {
    const red = leerRed()
    if (red) ctx.red = red
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') ctx.enLinea = navigator.onLine
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      ctx.segDesdeCarga = Math.round(performance.now() / 100) / 10
    }
  } catch {
    // Sin contexto, el reporte sale igual.
  }
  return ctx
}
