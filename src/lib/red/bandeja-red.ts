import { fetchPropio } from '@/lib/version/fetch-propio'
import {
  MAX_BYTES_LOTE_RED,
  MAX_EVENTOS_LOTE,
  RUTA_EVENTOS_RED,
  rutaNormalizada,
  type EventoFalla,
  type EventoRed,
  type Superficie,
} from './eventos'

/**
 * Bandeja de salida de los eventos del piloto de red, en localStorage.
 *
 * El aviso de un corte viaja por la misma red que se cortó: cada evento se anota ANTES de
 * mandarlo y se borra cuando el servidor contesta 204. Lo que quede sale en la próxima ventana,
 * al volver `online` o en la próxima carga. Puede llegar dos veces: se cuenta por `id`.
 *
 * Inerte hasta que `activarPilotoRed()` la enciende (solo en los workspaces del piloto): las
 * superficies llaman `anotarFallaRed` sin preguntar, y fuera del piloto no pasa nada.
 *
 * Todo acceso al almacén va en try/catch: Safari privado o cuota llena no rompen nada.
 */

export const CLAVE_BANDEJA_RED = 'metrik:red:bandeja'
const MAX_BANDEJA = 400
const MAX_EDAD_MS = 3 * 24 * 3600 * 1000

let activo = false
let enviando = false

export function activarPilotoRed(): void {
  activo = true
}

/** Solo pruebas. */
export function _reiniciarBandejaRed(): void {
  activo = false
  enviando = false
}

function almacen(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function fechaDe(e: EventoRed): number {
  return e.tipo === 'pulso' ? e.t1 : e.tipo === 'corte' ? e.inicio : e.t
}

export function leerBandeja(ahora: number = Date.now()): EventoRed[] {
  const a = almacen()
  if (!a) return []
  try {
    const lista: unknown = JSON.parse(a.getItem(CLAVE_BANDEJA_RED) ?? '[]')
    if (!Array.isArray(lista)) return []
    return (lista as EventoRed[]).filter(
      (e) => e && typeof e.id === 'string' && typeof e.tipo === 'string' && ahora - fechaDe(e) <= MAX_EDAD_MS,
    )
  } catch {
    return []
  }
}

function escribir(lista: EventoRed[]): void {
  const a = almacen()
  if (!a) return
  try {
    if (lista.length === 0) a.removeItem(CLAVE_BANDEJA_RED)
    else a.setItem(CLAVE_BANDEJA_RED, JSON.stringify(lista.slice(-MAX_BANDEJA)))
  } catch {
    // Cuota llena: la medición es lo de menos.
  }
}

export function anotarEventoRed(e: EventoRed): void {
  if (!activo) return
  const lista = leerBandeja().filter((x) => x.id !== e.id)
  lista.push(e)
  escribir(lista)
}

export function nuevoIdRed(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // sigue abajo
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Reloj monotónico para medir cuánto tardó algo hasta fallar (`anotarFallaRed({ desde })`). */
export function relojRed(): number {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

/**
 * Lo que una superficie anota cuando algo de la persona no llegó. No lanza nunca y no hace
 * nada fuera del piloto.
 */
export function anotarFallaRed(f: {
  superficie: Superficie
  error?: unknown
  ruta?: string
  dur_ms?: number
  /** Alternativa a `dur_ms`: la marca de `relojRed()` de cuando empezó. */
  desde?: number
  recuperado?: boolean
  intentos?: number
}): void {
  if (!activo) return
  try {
    const ev: EventoFalla = {
      tipo: 'falla',
      id: nuevoIdRed(),
      t: Date.now(),
      superficie: f.superficie,
      ruta: rutaNormalizada(f.ruta ?? (typeof window !== 'undefined' ? window.location.pathname : '/')),
      sw: typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller,
    }
    if (f.error !== undefined) {
      const err = f.error as { name?: unknown; message?: unknown }
      const texto = typeof err === 'string' ? err : `${String(err?.name ?? 'Error')}: ${String(err?.message ?? err)}`
      ev.error = texto.slice(0, 300)
    }
    const dur = typeof f.desde === 'number' ? relojRed() - f.desde : f.dur_ms
    if (typeof dur === 'number' && Number.isFinite(dur)) ev.dur_ms = Math.max(0, Math.round(dur))
    if (f.recuperado !== undefined) ev.recuperado = f.recuperado
    if (f.intentos !== undefined) ev.intentos = f.intentos
    anotarEventoRed(ev)
  } catch {
    // Nunca rompe la superficie que avisa.
  }
}

/** El lote que cabe en un envío (por cantidad y por bytes). */
export function loteParaEnviar(lista: EventoRed[]): EventoRed[] {
  const lote: EventoRed[] = []
  let bytes = 20
  for (const e of lista) {
    if (lote.length >= MAX_EVENTOS_LOTE) break
    const b = JSON.stringify(e).length + 1
    if (bytes + b > MAX_BYTES_LOTE_RED) break
    lote.push(e)
    bytes += b
  }
  return lote
}

/**
 * Manda lo que haya en la bandeja. `keepalive` para el envío al ocultar la pestaña (el
 * navegador lo termina aunque la página se cierre). Devuelve cuántos eventos confirmó el
 * servidor.
 */
export async function vaciarBandejaRed(opciones: { keepalive?: boolean } = {}): Promise<number> {
  if (!activo || enviando) return 0
  const lote = loteParaEnviar(leerBandeja())
  if (lote.length === 0) return 0
  enviando = true
  try {
    const res = await fetchPropio(RUTA_EVENTOS_RED, {
      method: 'POST',
      body: JSON.stringify({ eventos: lote }),
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      keepalive: opciones.keepalive === true,
      credentials: 'same-origin',
      // Sin sesión el middleware responde 307 a /login: no es una confirmación.
      redirect: 'manual',
    })
    if (res.status !== 204) return 0
    const enviados = new Set(lote.map((e) => e.id))
    escribir(leerBandeja().filter((e) => !enviados.has(e.id)))
    return lote.length
  } catch {
    return 0
  } finally {
    enviando = false
  }
}
