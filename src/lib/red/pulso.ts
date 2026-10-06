import type { EventoCorte, EventoPulso, ResumenSondas } from './eventos'

/**
 * El pulso de conexión del piloto de red, sin IO (el navegador pone las sondas y el reloj).
 *
 * Cada ronda manda DOS sondas a la vez: una a Vercel (un archivo estático del propio dominio,
 * servido por el CDN, sin función ni middleware) y otra a un punto de control FUERA de Vercel
 * (Supabase). Comparar las dos separa «se cayó el internet de la persona» (fallan las dos) de
 * «falla el camino a Vercel» (solo esa), que es lo que se sospecha de Claro/Telmex.
 *
 * Ritmo: una ronda cada 15 s con la pestaña visible; en cuanto una sonda falla, cada 2 s hasta
 * que las dos vuelven, para medir la duración del corte con ese margen. Un corte más corto que
 * el intervalo normal puede no verse: el pulso es un muestreo, no un registro continuo. Las
 * fallas de lo que la persona hizo (carga, subida…) se anotan aparte, una por una.
 *
 * Costo con 100 personas: ~8 sondas por minuto por pestaña visible (bytes, no funciones) y un
 * lote al servidor cada 5 minutos.
 */

export const INTERVALO_NORMAL_MS = 15_000
export const INTERVALO_CORTE_MS = 2_000
/** Una sonda que tarda más que esto cuenta como perdida. */
export const ESPERA_SONDA_MS = 4_000
/** Cada cuánto sale un resumen `pulso` (y con él, la bandeja). */
export const VENTANA_MS = 5 * 60_000

export interface ResultadoSonda {
  ok: boolean
  ms: number
}

export function percentil(ordenados: number[], p: number): number | undefined {
  if (ordenados.length === 0) return undefined
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1))
  return ordenados[i]
}

interface Acumulado {
  n: number
  perdidas: number
  latencias: number[]
}

function resumir(a: Acumulado): ResumenSondas {
  const ord = [...a.latencias].sort((x, y) => x - y)
  const r: ResumenSondas = { n: a.n, perdidas: a.perdidas }
  if (ord.length > 0) {
    r.p50 = Math.round(percentil(ord, 50)!)
    r.p95 = Math.round(percentil(ord, 95)!)
    r.max = Math.round(ord[ord.length - 1])
  }
  return r
}

const vacio = (): Acumulado => ({ n: 0, perdidas: 0, latencias: [] })

export interface Medidor {
  /** Anota una ronda que salió en `t`. Devuelve el corte si esta ronda lo cierra. */
  anotarRonda(t: number, vercel: ResultadoSonda, control: ResultadoSonda, ruta?: string): EventoCorte | null
  /** ¿Hay un corte abierto? (decide el intervalo de la próxima ronda). */
  enCorte(): boolean
  intervalo(): number
  /** La pestaña se ocultó: cierra el corte abierto con lo medido hasta su última ronda. */
  cerrarPorOculta(t: number): EventoCorte | null
  anotarVisible(ms: number): void
  anotarOffline(ms: number): void
  /** El resumen de la ventana (y empieza otra). `null` si no se midió nada. */
  tomarVentana(t: number, red?: EventoPulso['red']): EventoPulso | null
}

export function crearMedidor(opts: { inicio: number; nuevoId: () => string; sw: () => boolean }): Medidor {
  let t0 = opts.inicio
  let vercel = vacio()
  let control = vacio()
  let visibleMs = 0
  let offlineMs = 0
  let corte: { inicio: number; ultima: number; vercel: boolean; control: boolean; ruta?: string } | null = null

  const sumar = (a: Acumulado, s: ResultadoSonda) => {
    a.n++
    if (s.ok) a.latencias.push(Math.max(0, s.ms))
    else a.perdidas++
  }

  const cerrar = (fin: number, cierre: 'volvio' | 'oculta'): EventoCorte | null => {
    if (!corte) return null
    const ev: EventoCorte = {
      tipo: 'corte',
      id: opts.nuevoId(),
      inicio: corte.inicio,
      dur_ms: Math.max(0, Math.round(fin - corte.inicio)),
      vercel: corte.vercel,
      control: corte.control,
      cierre,
      sw: opts.sw(),
    }
    if (corte.ruta) ev.ruta = corte.ruta
    corte = null
    return ev
  }

  return {
    anotarRonda(t, v, c, ruta) {
      sumar(vercel, v)
      sumar(control, c)
      if (!v.ok || !c.ok) {
        if (!corte) corte = { inicio: t, ultima: t, vercel: false, control: false, ruta }
        corte.ultima = t
        corte.vercel ||= !v.ok
        corte.control ||= !c.ok
        return null
      }
      return cerrar(t, 'volvio')
    },
    enCorte: () => corte !== null,
    intervalo: () => (corte ? INTERVALO_CORTE_MS : INTERVALO_NORMAL_MS),
    cerrarPorOculta(t) {
      if (!corte) return null
      // Piso: lo último que se sabe es la última ronda fallida (o el momento de ocultarse).
      return cerrar(Math.max(corte.ultima, Math.min(t, corte.ultima + INTERVALO_CORTE_MS)), 'oculta')
    },
    anotarVisible(ms) {
      if (ms > 0) visibleMs += ms
    },
    anotarOffline(ms) {
      if (ms > 0) offlineMs += ms
    },
    tomarVentana(t, red) {
      if (vercel.n === 0 && control.n === 0 && visibleMs === 0) {
        t0 = t
        return null
      }
      const ev: EventoPulso = {
        tipo: 'pulso',
        id: opts.nuevoId(),
        t0,
        t1: t,
        visible_ms: Math.round(visibleMs),
        vercel: resumir(vercel),
        control: resumir(control),
        offline_ms: Math.round(offlineMs),
        sw: opts.sw(),
      }
      if (red) ev.red = red
      t0 = t
      vercel = vacio()
      control = vacio()
      visibleMs = 0
      offlineMs = 0
      return ev
    },
  }
}
