/**
 * Las fechas de un servicio del viaje: inicio, fin, horas y, en un vuelo, sus tramos. Módulo puro
 * (lo usan el servidor y el navegador). Base de los hitos de gestión
 * (`noor-hana-hitos-de-gestion-2026-10-21.md` §4.1-4.2).
 *
 * Regla de Hana: la fecha se lee de la cotización, se corrige en la fila y nunca se pide aparte.
 * Lo que no se leyó queda vacío: «Falta la fecha». Nada se adivina (ni el año de «21 nov»).
 *
 * Un vuelo redondo es UNA fila con dos tramos (así se cotiza y se paga: partirlo rompería el
 * cuadre de costo F0-2). Su inicio es el primer tramo y su fin el último.
 */

export interface TramoServicio {
  fecha: string
  hora_salida: string | null
  hora_llegada: string | null
  origen: string | null
  destino: string | null
  aerolinea: string | null
  numero_vuelo: string | null
}

export interface FechasServicio {
  fecha_servicio: string | null
  fecha_fin: string | null
  hora_inicio: string | null
  hora_fin: string | null
  /** Solo vuelos. `null` en los demás tipos. */
  tramos: TramoServicio[] | null
}

export const SIN_FECHAS: FechasServicio = { fecha_servicio: null, fecha_fin: null, hora_inicio: null, hora_fin: null, tramos: null }

/** El tope de tramos por fila (el mismo del CHECK de la base). */
export const MAX_TRAMOS = 12
const MAX_TEXTO_TRAMO = 100

/** `AAAA-MM-DD` válida (sin el año, o un día imposible, no). */
export function esFechaIso(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/**
 * `HH:MM` de 24 horas, o `null`. Acepta los segundos de una columna `time` («06:10:00»). Un valor
 * con cola («06:10 (del viaje)») no es una hora leída de la pantalla: no se toma.
 */
export function horaHHMM(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(v.trim())
  return m ? `${m[1]}:${m[2]}` : null
}

export function sumarDiasIso(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * El día N del viaje como fecha: salida + (N − 1). Sin salida, o sin un día entero ≥ 1, `null`
 * (no se inventa).
 */
export function fechaPorDiaDelViaje(salida: string | null | undefined, dia: number | null | undefined): string | null {
  if (!esFechaIso(salida) || typeof dia !== 'number' || !Number.isInteger(dia) || dia < 1) return null
  return sumarDiasIso(salida, dia - 1)
}

function textoTramo(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t.slice(0, MAX_TEXTO_TRAMO)
}

/** Las fechas de la fila salen de sus tramos: inicio = el primero, fin = el último. */
export function fechasDeTramos(tramos: readonly TramoServicio[]): FechasServicio {
  if (tramos.length === 0) return { ...SIN_FECHAS, tramos: [] }
  const primero = tramos[0]
  const ultimo = tramos[tramos.length - 1]
  return {
    fecha_servicio: primero.fecha,
    fecha_fin: ultimo.fecha,
    hora_inicio: primero.hora_salida,
    hora_fin: ultimo.hora_llegada,
    tramos: tramos.map(t => ({ ...t })),
  }
}

/** Lee los tramos guardados (jsonb) sin confiar en su forma: lo que no es un tramo se cae. */
export function leerTramos(v: unknown): TramoServicio[] | null {
  if (!Array.isArray(v)) return null
  const out: TramoServicio[] = []
  for (const t of v) {
    if (!t || typeof t !== 'object') continue
    const r = t as Record<string, unknown>
    if (!esFechaIso(r.fecha)) continue
    out.push({
      fecha: r.fecha,
      hora_salida: horaHHMM(r.hora_salida),
      hora_llegada: horaHHMM(r.hora_llegada),
      origen: textoTramo(r.origen),
      destino: textoTramo(r.destino),
      aerolinea: textoTramo(r.aerolinea),
      numero_vuelo: textoTramo(r.numero_vuelo),
    })
  }
  return out
}

/** Las fechas de una fila tal como vienen de la base (horas `time` con segundos, tramos jsonb). */
export function fechasDeFila(f: {
  fecha_servicio?: string | null
  fecha_fin?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
  tramos?: unknown
}): FechasServicio {
  return {
    fecha_servicio: esFechaIso(f.fecha_servicio) ? f.fecha_servicio : null,
    fecha_fin: esFechaIso(f.fecha_fin) ? f.fecha_fin : null,
    hora_inicio: horaHHMM(f.hora_inicio),
    hora_fin: horaHHMM(f.hora_fin),
    tramos: leerTramos(f.tramos),
  }
}

/** ¿Las dos dicen lo mismo? (los tramos vacíos y `null` cuentan igual). */
export function mismasFechas(a: FechasServicio, b: FechasServicio): boolean {
  const tramos = (x: FechasServicio) => JSON.stringify(x.tramos && x.tramos.length > 0 ? x.tramos : null)
  return a.fecha_servicio === b.fecha_servicio && a.fecha_fin === b.fecha_fin
    && a.hora_inicio === b.hora_inicio && a.hora_fin === b.hora_fin && tramos(a) === tramos(b)
}

/**
 * Lo que el completado le escribe a una fila ya generada, o `null` si no hay nada que escribir.
 *
 * Las fechas de la lectura van COMO UN TODO (inicio, fin, horas y tramos juntos: cambiar solo el
 * inicio podría dejar un fin anterior). Si la lectura no trae inicio, no se toca nada: completar
 * no borra lo que la fila ya tiene. Lo corregido a mano ni llega aquí (lo filtra quien llama).
 */
export function completadoDeFila(actual: FechasServicio, leidas: FechasServicio): FechasServicio | null {
  if (!leidas.fecha_servicio) return null
  return mismasFechas(actual, leidas) ? null : leidas
}

// ── Lo que se corrige a mano ────────────────────────────────────────────────

export interface TramoEditado {
  fecha?: string | null
  hora_salida?: string | null
  hora_llegada?: string | null
  origen?: string | null
  destino?: string | null
  aerolinea?: string | null
  numero_vuelo?: string | null
}

export interface FechasEditadas {
  fecha_servicio?: string | null
  fecha_fin?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
  /** Solo vuelos: si viene, manda sobre inicio y fin. */
  tramos?: TramoEditado[] | null
}

const vacio = (v: string | null | undefined) => (v ?? '').trim() === ''

/** Una hora escrita: vacía = `null`; mal escrita = error. */
function horaEscrita(v: string | null | undefined): { ok: true; hora: string | null } | { ok: false } {
  if (vacio(v)) return { ok: true, hora: null }
  const h = horaHHMM(v)
  return h ? { ok: true, hora: h } : { ok: false }
}

/**
 * Valida lo que la asesora escribió en la hoja de la fila y lo deja como se guarda. Copy literal
 * para el toast: el error se lee tal cual.
 */
export function validarFechasEditadas(
  tipo: string,
  e: FechasEditadas,
): { ok: true; fechas: FechasServicio } | { ok: false; error: string } {
  // «otro» con tramos: el paquete de bloqueo y su vuelo (H10, 2026-10-29).
  if ((tipo === 'vuelo' || tipo === 'otro') && Array.isArray(e.tramos)) {
    if (e.tramos.length > MAX_TRAMOS) return { ok: false, error: `Un vuelo tiene hasta ${MAX_TRAMOS} tramos.` }
    const tramos: TramoServicio[] = []
    for (const [i, t] of e.tramos.entries()) {
      const n = i + 1
      const fecha = (t.fecha ?? '').trim()
      if (!esFechaIso(fecha)) return { ok: false, error: `Falta la fecha del tramo ${n}.` }
      const sale = horaEscrita(t.hora_salida)
      const llega = horaEscrita(t.hora_llegada)
      if (!sale.ok || !llega.ok) return { ok: false, error: `La hora del tramo ${n} no es válida.` }
      if (tramos.length > 0 && fecha < tramos[tramos.length - 1].fecha) {
        return { ok: false, error: `El tramo ${n} sale antes que el tramo ${n - 1}.` }
      }
      tramos.push({
        fecha,
        hora_salida: sale.hora,
        hora_llegada: llega.hora,
        origen: textoTramo(t.origen),
        destino: textoTramo(t.destino),
        aerolinea: textoTramo(t.aerolinea),
        numero_vuelo: textoTramo(t.numero_vuelo),
      })
    }
    return { ok: true, fechas: fechasDeTramos(tramos) }
  }

  const inicio = (e.fecha_servicio ?? '').trim()
  const fin = (e.fecha_fin ?? '').trim()
  if (inicio !== '' && !esFechaIso(inicio)) return { ok: false, error: 'La fecha de inicio no es válida.' }
  if (fin !== '' && !esFechaIso(fin)) return { ok: false, error: 'La fecha de fin no es válida.' }
  if (fin !== '' && inicio === '') return { ok: false, error: 'Pon primero la fecha de inicio.' }
  if (fin !== '' && fin < inicio) return { ok: false, error: 'El fin no puede ser antes del inicio.' }
  const hi = horaEscrita(e.hora_inicio)
  const hf = horaEscrita(e.hora_fin)
  if (!hi.ok || !hf.ok) return { ok: false, error: 'La hora no es válida.' }
  // El mismo día, terminar antes de empezar no es un servicio (un vuelo nocturno va por tramos).
  const mismoDia = fin === '' || fin === inicio
  if (mismoDia && hi.hora && hf.hora && hf.hora < hi.hora) return { ok: false, error: 'El fin no puede ser antes del inicio.' }
  return {
    ok: true,
    fechas: {
      fecha_servicio: inicio === '' ? null : inicio,
      fecha_fin: fin === '' ? null : fin,
      hora_inicio: inicio === '' ? null : hi.hora,
      hora_fin: hf.hora,
      tramos: null,
    },
  }
}

// ── Cómo se lee en pantalla ─────────────────────────────────────────────────

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «lun 10 nov» (sin depender del idioma del navegador ni de su zona horaria). */
export function fechaEnPalabras(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
}

/** «lun 10 nov · 06:10 → sáb 15 nov» o `null` si no hay inicio («Falta la fecha»). */
export function resumenDeFechas(f: FechasServicio): string | null {
  if (!f.fecha_servicio) return null
  const inicio = `${fechaEnPalabras(f.fecha_servicio)}${f.hora_inicio ? ` · ${f.hora_inicio}` : ''}`
  if (!f.fecha_fin || (f.fecha_fin === f.fecha_servicio && !f.hora_fin)) return inicio
  const fin = f.fecha_fin === f.fecha_servicio ? (f.hora_fin as string) : `${fechaEnPalabras(f.fecha_fin)}${f.hora_fin ? ` · ${f.hora_fin}` : ''}`
  return `${inicio} → ${fin}`
}

export const FALTA_LA_FECHA = 'Falta la fecha'

/** «JetSMART 5260 BOG → ADZ · JetSMART 5261 ADZ → BOG»: los vuelos de una fila, en una línea. */
export function vuelosEnLinea(tramos: readonly TramoServicio[] | null | undefined): string | null {
  const partes = (tramos ?? [])
    .map(t => [[t.aerolinea, t.numero_vuelo].filter(Boolean).join(' '), [t.origen, t.destino].filter(Boolean).join(' → ')].filter(Boolean).join(' '))
    .filter(Boolean)
  return partes.length > 0 ? partes.join(' · ') : null
}
