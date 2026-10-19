/**
 * El calendario de temporadas de la agencia (Mauricio, 2026-10-19). PURO.
 *
 * Cada hotel tiene sus temporadas; cuando su tarifario no trae fechas, la agencia decide alta,
 * media o baja por la fecha del viaje. ONE guarda un calendario propio por año (tabla
 * `temporadas_agencia`) que se arma una vez al año copiando el anterior.
 *
 *   · Un rango pertenece al año de su «desde» y puede cruzar al siguiente (15-dic a 15-ene).
 *   · Si dos rangos se pisan, manda alta sobre media sobre baja (Semana Santa = alta, regla de
 *     Mauricio, aunque caiga dentro de una media).
 *   · Copiar un año corre las fechas al año nuevo; un rango que se llame «Semana Santa» se
 *     recalcula con la Pascua del año nuevo (domingo de Ramos a domingo de Resurrección), porque
 *     cambia de fecha cada año.
 */

export const TEMPORADAS = ['alta', 'media', 'baja'] as const
export type Temporada = (typeof TEMPORADAS)[number]

export const NOMBRE_TEMPORADA: Record<Temporada, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' }

const PRIORIDAD: Record<Temporada, number> = { alta: 0, media: 1, baja: 2 }

export interface RangoTemporada {
  id?: string
  anio: number
  temporada: Temporada
  /** `YYYY-MM-DD`. */
  desde: string
  hasta: string
  nombre: string | null
}

export function esTemporada(t: unknown): t is Temporada {
  return typeof t === 'string' && (TEMPORADAS as readonly string[]).includes(t)
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

/** Fecha `YYYY-MM-DD` válida o `null`. */
export function fechaValida(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = FECHA.exec(v)
  if (!m) return null
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const f = new Date(Date.UTC(a, mes - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d ? v : null
}

function dia(f: string): number {
  const m = FECHA.exec(f) as RegExpExecArray
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

function deDia(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10)
}

/** Un rango como llega del formulario, revisado. */
export function revisarRango(e: unknown): { ok: true; rango: RangoTemporada } | { ok: false; error: string } {
  const d = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
  if (!esTemporada(d.temporada)) return { ok: false, error: 'Elige si es alta, media o baja.' }
  const desde = fechaValida(d.desde)
  const hasta = fechaValida(d.hasta)
  if (!desde || !hasta) return { ok: false, error: 'Escribe las dos fechas del rango.' }
  if (hasta < desde) return { ok: false, error: '«Hasta» no puede ser antes de «desde».' }
  if (dia(hasta) - dia(desde) > 366) return { ok: false, error: 'Un rango no puede durar más de un año.' }
  const anio = Number(desde.slice(0, 4))
  if (anio < 2020 || anio > 2100) return { ok: false, error: 'El año no es válido.' }
  const nombre = typeof d.nombre === 'string' && d.nombre.trim() ? d.nombre.trim().replace(/\s+/g, ' ').slice(0, 120) : null
  return { ok: true, rango: { anio, temporada: d.temporada, desde, hasta, nombre } }
}

/**
 * La temporada de una fecha según el calendario: la de mayor prioridad entre los rangos que la
 * cubren. `null` si ningún rango la cubre (la agencia no la ha definido).
 */
export function temporadaDeFecha(rangos: readonly RangoTemporada[], fecha: string): { temporada: Temporada; rango: RangoTemporada } | null {
  if (!fechaValida(fecha)) return null
  const cubren = rangos.filter((r) => r.desde <= fecha && fecha <= r.hasta)
  if (cubren.length === 0) return null
  const rango = [...cubren].sort((a, b) => PRIORIDAD[a.temporada] - PRIORIDAD[b.temporada] || a.desde.localeCompare(b.desde))[0]
  return { temporada: rango.temporada, rango }
}

/** Domingo de Pascua (algoritmo anónimo gregoriano), `YYYY-MM-DD`. */
export function domingoDePascua(anio: number): string {
  const a = anio % 19
  const b = Math.floor(anio / 100)
  const c = anio % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const diaMes = ((h + l - 7 * m + 114) % 31) + 1
  return `${anio}-${String(mes).padStart(2, '0')}-${String(diaMes).padStart(2, '0')}`
}

/** Semana Santa de un año: del domingo de Ramos al domingo de Resurrección. */
export function semanaSanta(anio: number): { desde: string; hasta: string } {
  const pascua = domingoDePascua(anio)
  return { desde: deDia(dia(pascua) - 7), hasta: pascua }
}

export function esSemanaSanta(nombre: string | null | undefined): boolean {
  return (nombre ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .includes('semana santa')
}

/** La misma fecha de calendario `n` años después (29-feb cae en 28-feb si el año no es bisiesto). */
function correrAnios(f: string, n: number): string {
  const m = FECHA.exec(f) as RegExpExecArray
  const anio = Number(m[1]) + n
  const mes = Number(m[2])
  let d = Number(m[3])
  while (d > 28 && !fechaValida(`${anio}-${m[2]}-${String(d).padStart(2, '0')}`)) d--
  return `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * «Copiar del año anterior»: los rangos de `origen` corridos a `destino`. Semana Santa se
 * recalcula; el resto conserva día y mes. `recalculado` marca los que no son una copia literal
 * (para que la persona los revise).
 */
export function copiarAnio(rangos: readonly RangoTemporada[], origen: number, destino: number): (RangoTemporada & { recalculado: boolean })[] {
  const n = destino - origen
  return rangos
    .filter((r) => r.anio === origen)
    .map((r) => {
      if (esSemanaSanta(r.nombre)) {
        const ss = semanaSanta(destino)
        return { anio: destino, temporada: r.temporada, nombre: r.nombre, desde: ss.desde, hasta: ss.hasta, recalculado: true }
      }
      return { anio: destino, temporada: r.temporada, nombre: r.nombre, desde: correrAnios(r.desde, n), hasta: correrAnios(r.hasta, n), recalculado: false }
    })
    .sort((a, b) => a.desde.localeCompare(b.desde))
}

/** Rangos de temporadas DISTINTAS que se pisan (informativo: la prioridad resuelve). */
export function solapes(rangos: readonly RangoTemporada[]): [RangoTemporada, RangoTemporada][] {
  const salida: [RangoTemporada, RangoTemporada][] = []
  const orden = [...rangos].sort((a, b) => a.desde.localeCompare(b.desde))
  for (let i = 0; i < orden.length; i++) {
    for (let j = i + 1; j < orden.length && orden[j].desde <= orden[i].hasta; j++) {
      if (orden[i].temporada !== orden[j].temporada) salida.push([orden[i], orden[j]])
    }
  }
  return salida
}

/** Días de un año que ningún rango cubre (para avisar «sin temporada» en la pantalla). */
export function diasSinTemporada(rangos: readonly RangoTemporada[], anio: number): number {
  const inicio = dia(`${anio}-01-01`)
  const fin = dia(`${anio}-12-31`)
  let libres = 0
  for (let d = inicio; d <= fin; d++) {
    const f = deDia(d)
    if (!rangos.some((r) => r.desde <= f && f <= r.hasta)) libres++
  }
  return libres
}
