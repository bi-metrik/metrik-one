import type { ContextoRed } from '@/lib/red/contexto-red'

/**
 * Junta en memoria lo que mide el navegador (web vitals y navegaciones suaves) y lo arma
 * en UN beacon por ciclo de pagina (cada vez que la pestaña se oculta o se cierra). Un
 * beacon por metrica le sumaria viajes a una red que ya pierde paquetes.
 *
 * Puro y sin DOM: el componente `components/rum/rum-red.tsx` le pasa los hechos y manda
 * lo que este devuelva. SIN dependencias de servidor (corre en el navegador).
 */

/** Version del formato del beacon. Subirla si cambia la forma (el endpoint la valida). */
export const VERSION_BEACON = 1
/** Navegaciones por beacon. Las de mas se cuentan en `navsDescartadas`, no viajan. */
export const MAX_NAVS = 30
/** Una navegacion que tarda mas que esto se da por abandonada (otra la reemplazo, o nunca terminó). */
export const MAX_DURACION_NAV_MS = 120_000

export type NombreVital = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'
const VITALES: ReadonlySet<string> = new Set<NombreVital>(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'])
/** Las que miden la carga completa: su ruta es la de entrada, no la de cuando se reportan. */
const DE_LA_CARGA: ReadonlySet<string> = new Set(['LCP', 'FCP', 'TTFB'])

export type TipoNavegacion = 'tarjeta' | 'enlace' | 'historial'

export interface Vital {
  n: NombreVital
  /** ms, salvo CLS (sin unidad, 4 decimales). */
  v: number
  /** 'good' | 'needs-improvement' | 'poor', como lo califica web-vitals. */
  r?: string
  ruta: string
}

export interface Navegacion {
  de: string
  a: string
  ms: number
  tipo: TipoNavegacion
}

export interface Beacon extends ContextoRed {
  v: number
  /** Id aleatorio de esta carga completa: junta los beacons de una misma pestaña-carga. */
  carga: string
  /** Numero de beacon dentro de la carga (1, 2, …). */
  ciclo: number
  /** Ruta donde se cargo la pagina (normalizada). */
  entrada: string
  /** Ruta al momento de mandar (normalizada). */
  ruta: string
  version: string
  vitales: Vital[]
  navs: Navegacion[]
  navsDescartadas?: number
}

interface MetricaWebVitals {
  name: string
  value: number
  rating?: string
}

export interface Colector {
  anotarVital(m: MetricaWebVitals, rutaActual: string): void
  /** Empieza a medir una navegacion. Una nueva reemplaza a la anterior sin terminar. */
  iniciarNavegacion(tipo: TipoNavegacion, desde: string, ahora: number): void
  /** El destino ya pinto (cambio la ruta). Sin inicio vigente no anota nada. */
  terminarNavegacion(destino: string, ahora: number): void
  /** El beacon con lo nuevo desde el ultimo, o `null` si no hay nada que mandar. Vacia lo juntado. */
  tomarBeacon(rutaActual: string, contexto: ContextoRed): Beacon | null
}

export function crearColector(opciones: { carga: string; entrada: string; version: string }): Colector {
  // Ultimo valor por metrica: INP y CLS pueden reportarse otra vez si cambian.
  const vitales = new Map<NombreVital, Vital>()
  let navs: Navegacion[] = []
  let descartadas = 0
  let ciclo = 0
  let inicio: { tipo: TipoNavegacion; desde: string; t: number } | null = null

  return {
    anotarVital(m, rutaActual) {
      if (!m || !VITALES.has(m.name) || typeof m.value !== 'number' || !Number.isFinite(m.value)) return
      const n = m.name as NombreVital
      vitales.set(n, {
        n,
        v: n === 'CLS' ? Math.round(m.value * 10_000) / 10_000 : Math.round(m.value),
        ...(typeof m.rating === 'string' ? { r: m.rating } : {}),
        ruta: DE_LA_CARGA.has(n) ? opciones.entrada : rutaActual,
      })
    },

    iniciarNavegacion(tipo, desde, ahora) {
      inicio = { tipo, desde, t: ahora }
    },

    terminarNavegacion(destino, ahora) {
      const i = inicio
      inicio = null
      if (!i) return
      const ms = Math.round(ahora - i.t)
      if (ms < 0 || ms > MAX_DURACION_NAV_MS) return
      if (navs.length >= MAX_NAVS) {
        descartadas += 1
        return
      }
      navs.push({ de: i.desde, a: destino, ms, tipo: i.tipo })
    },

    tomarBeacon(rutaActual, contexto) {
      if (vitales.size === 0 && navs.length === 0) return null
      ciclo += 1
      const beacon: Beacon = {
        v: VERSION_BEACON,
        carga: opciones.carga,
        ciclo,
        entrada: opciones.entrada,
        ruta: rutaActual,
        version: opciones.version,
        ...contexto,
        vitales: [...vitales.values()],
        navs,
        ...(descartadas > 0 ? { navsDescartadas: descartadas } : {}),
      }
      vitales.clear()
      navs = []
      descartadas = 0
      return beacon
    },
  }
}
