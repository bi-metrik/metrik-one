// Festivos de Colombia CALCULADOS, no copiados de una lista que envejece.
//
// Ley 51 de 1983 ("Ley Emiliani") + Pascua por el algoritmo de Meeus/Jones/Butcher.
// Es el espejo en TypeScript de la funcion SQL `festivos_colombia_de(anio)`
// (migracion 20260927000001) y del script de referencia del sistema
// `metrik-system/.claude/scripts/calendario-co.py`. Si se toca uno, se tocan los tres
// y sus tests.
//
// Por que existe: hasta el 2026-09-27 `festivos_colombia` tenia 2026 y 2027 escritos a
// mano, y un anio sin sembrar cuenta sus festivos como habiles sin avisar.

export interface Festivo {
  /** 'YYYY-MM-DD' */
  fecha: string
  descripcion: string
}

const DIA_MS = 86_400_000

/** Domingo de Pascua (gregoriano), como epoch ms a medianoche UTC. */
function pascuaMs(anio: number): number {
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
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(anio, mes - 1, dia)
}

/** 'YYYY-MM-DD' del domingo de Pascua. */
export function pascua(anio: number): string {
  return iso(pascuaMs(anio))
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Ley Emiliani: si no cae lunes, pasa al lunes siguiente. */
function lunes(ms: number): number {
  const dow = new Date(ms).getUTCDay() // 0 = domingo, 1 = lunes
  return ms + ((8 - dow) % 7) * DIA_MS
}

/** Los 18 festivos del anio, ordenados por fecha. */
export function festivosColombia(anio: number): Festivo[] {
  const p = pascuaMs(anio)
  const d = (mes: number, dia: number) => Date.UTC(anio, mes - 1, dia)
  const lista: Array<[number, string]> = [
    [d(1, 1), 'Año Nuevo'],
    [lunes(d(1, 6)), 'Reyes Magos'],
    [lunes(d(3, 19)), 'San José'],
    [p - 3 * DIA_MS, 'Jueves Santo'],
    [p - 2 * DIA_MS, 'Viernes Santo'],
    [d(5, 1), 'Día del Trabajo'],
    [lunes(p + 39 * DIA_MS), 'Ascensión del Señor'],
    [lunes(p + 60 * DIA_MS), 'Corpus Christi'],
    [lunes(p + 68 * DIA_MS), 'Sagrado Corazón'],
    [lunes(d(6, 29)), 'San Pedro y San Pablo'],
    [d(7, 20), 'Independencia'],
    [d(8, 7), 'Batalla de Boyacá'],
    [lunes(d(8, 15)), 'Asunción de la Virgen'],
    [lunes(d(10, 12)), 'Día de la Raza'],
    [lunes(d(11, 1)), 'Todos los Santos'],
    [lunes(d(11, 11)), 'Independencia de Cartagena'],
    [d(12, 8), 'Inmaculada Concepción'],
    [d(12, 25), 'Navidad'],
  ]
  return lista
    .sort((x, y) => x[0] - y[0])
    .map(([ms, descripcion]) => ({ fecha: iso(ms), descripcion }))
}

/** ¿'YYYY-MM-DD' es dia habil en Colombia? (lunes a viernes y no festivo) */
export function esHabilColombia(fecha: string): boolean {
  const ms = Date.parse(`${fecha}T00:00:00Z`)
  const dow = new Date(ms).getUTCDay()
  if (dow === 0 || dow === 6) return false
  const anio = Number(fecha.slice(0, 4))
  return !festivosColombia(anio).some((f) => f.fecha === fecha)
}
