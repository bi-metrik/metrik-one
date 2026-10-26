/**
 * Lo que el piloto de red manda a `POST /api/red/eventos`. Sin dependencias (corre en el
 * navegador y en el service worker; Zod solo en el servidor, `eventos-servidor.ts`).
 *
 * Tres clases de evento, todas con `id` propio: un lote puede llegar dos veces (la bandeja lo
 * reenvía si no vio la respuesta) y al contar se cuenta por `id` distinto.
 *
 * - `pulso`: resumen de una ventana (hasta 5 min) de sondas hacia Vercel y hacia el punto de
 *   control fuera de Vercel. Es el denominador: cuánto tiempo se midió y cuántas sondas se
 *   perdieron.
 * - `corte`: un tramo en que al menos una sonda no respondió, con su duración y QUÉ destino
 *   falló. Los dos = se cayó el internet de la persona; solo Vercel = falla el camino a
 *   Vercel; solo el control = falla el camino al control.
 * - `falla`: algo que la persona hizo y no llegó, por superficie (carga de página, navegación
 *   interna, acción, subida, descarga, consulta de la lectura).
 */

export const RUTA_EVENTOS_RED = '/api/red/eventos'

/** Tope del cuerpo de un lote (el `keepalive` del navegador permite 64 KB). */
export const MAX_BYTES_LOTE_RED = 48 * 1024
export const MAX_EVENTOS_LOTE = 120

export type Superficie = 'carga' | 'navegacion' | 'accion' | 'subida' | 'descarga' | 'lectura'

export interface ResumenSondas {
  /** Sondas enviadas. */
  n: number
  /** Sin respuesta (error de red o más de `ESPERA_SONDA_MS`). */
  perdidas: number
  /** Latencia de las que respondieron, en ms. */
  p50?: number
  p95?: number
  max?: number
}

export interface EventoPulso {
  tipo: 'pulso'
  id: string
  /** Inicio y fin de la ventana (epoch ms del navegador). */
  t0: number
  t1: number
  /** Tiempo con la pestaña visible dentro de la ventana. */
  visible_ms: number
  vercel: ResumenSondas
  control: ResumenSondas
  /** Ms con `navigator.onLine === false` dentro de la ventana. */
  offline_ms: number
  /** La página está controlada por el service worker del piloto (antes/después). */
  sw: boolean
  red?: { tipo?: string; rtt?: number; bajadaMbps?: number }
}

export interface EventoCorte {
  tipo: 'corte'
  id: string
  /** Primera sonda sin respuesta. */
  inicio: number
  /** Hasta la primera sonda que volvió a responder (o hasta que se ocultó la pestaña). */
  dur_ms: number
  /** Falló la sonda hacia Vercel durante el corte. */
  vercel: boolean
  /** Falló la sonda hacia el control (fuera de Vercel) durante el corte. */
  control: boolean
  /** `oculta`: la pestaña se ocultó con el corte abierto; la duración es un piso. */
  cierre?: 'volvio' | 'oculta'
  ruta?: string
  sw: boolean
}

export interface EventoFalla {
  tipo: 'falla'
  id: string
  t: number
  superficie: Superficie
  /** Ruta normalizada (`/negocios/[id]`), sin query. */
  ruta?: string
  /** Mensaje del error, recortado. */
  error?: string
  /** Lo que tardó hasta fallar. */
  dur_ms?: number
  /** `true` = se recuperó sola (reintento del service worker o de la bandeja). */
  recuperado?: boolean
  intentos?: number
  sw?: boolean
}

export type EventoRed = EventoPulso | EventoCorte | EventoFalla

export interface LoteRed {
  eventos: EventoRed[]
}

const UUID_O_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** `/negocios/84630bca-…` → `/negocios/[id]`. Sin query ni hash. */
export function rutaNormalizada(pathname: string): string {
  return pathname.split(/[?#]/)[0].replace(UUID_O_ID, '[id]').slice(0, 200)
}
