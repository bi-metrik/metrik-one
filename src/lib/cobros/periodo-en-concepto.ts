/**
 * El periodo que paga una cuota, leído de su concepto. Puro.
 *
 * El concepto lo trae en una de dos formas:
 *   · la numérica, con año: «… — periodo del 23/09/2026 al 22/10/2026» (las cuotas cargadas
 *     hasta el 2026-09-24);
 *   · la de la redacción fiscal de Felipe (2026-09-24), sin año:
 *     «Suscripción VALIDA · Plan CDA — … · periodo del 23-sep al 22-oct».
 *
 * La forma sin año se ancla en el vencimiento de la cuota: las cuotas de los CDA vencen dentro del
 * periodo que pagan (o a días de él), así que el año del inicio es el que deja el inicio más cerca
 * del vencimiento. Sin vencimiento, esa forma da el texto pero no las fechas.
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

const RE =
  /periodo del (?:(\d{2})\/(\d{2})\/(\d{4}) al (\d{2})\/(\d{2})\/(\d{4})|(\d{1,2})-(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic) al (\d{1,2})-(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic))/i

/** El separador que antecede al periodo en el concepto: « — », « · » o «, ». */
const RE_CON_SEPARADOR = new RegExp(`\\s*(?:[—–·,-]\\s*)?${RE.source}`, 'i')

export interface PeriodoEnConcepto {
  /** El fragmento tal cual: «periodo del 23-sep al 22-oct». */
  texto: string
  /** «23-sep al 22-oct». */
  corto: string
  /** 'YYYY-MM-DD'; `null` si la forma no trae año y no hubo vencimiento con qué anclarla. */
  desde: string | null
  hasta: string | null
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function valida(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

const dias = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000

export function leerPeriodoEnConcepto(concepto: string | null, fechaVencimiento?: string | null): PeriodoEnConcepto | null {
  const m = concepto ? RE.exec(concepto) : null
  if (!m) return null
  if (m[1]) {
    const [d1, m1, y1, d2, m2, y2] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number)
    const ok = valida(y1, m1, d1) && valida(y2, m2, d2)
    return {
      texto: m[0],
      corto: `${d1}-${MESES[m1 - 1] ?? '?'} al ${d2}-${MESES[m2 - 1] ?? '?'}`,
      desde: ok ? iso(y1, m1, d1) : null,
      hasta: ok ? iso(y2, m2, d2) : null,
    }
  }
  const d1 = Number(m[7])
  const m1 = MESES.indexOf(m[8].toLowerCase() as (typeof MESES)[number]) + 1
  const d2 = Number(m[9])
  const m2 = MESES.indexOf(m[10].toLowerCase() as (typeof MESES)[number]) + 1
  const corto = `${d1}-${MESES[m1 - 1]} al ${d2}-${MESES[m2 - 1]}`
  const v = fechaVencimiento && /^\d{4}-\d{2}-\d{2}$/.test(fechaVencimiento) ? fechaVencimiento : null
  if (!v) return { texto: m[0], corto, desde: null, hasta: null }

  // El año del inicio: el que lo deja más cerca del vencimiento.
  const yv = Number(v.slice(0, 4))
  const candidatos = [yv - 1, yv, yv + 1].filter((y) => valida(y, m1, d1))
  if (candidatos.length === 0) return { texto: m[0], corto, desde: null, hasta: null }
  const y1 = candidatos.reduce((a, b) => (Math.abs(dias(iso(b, m1, d1), v)) < Math.abs(dias(iso(a, m1, d1), v)) ? b : a))
  const desde = iso(y1, m1, d1)
  let y2 = y1
  if (!valida(y2, m2, d2) || iso(y2, m2, d2) < desde) y2 += 1
  if (!valida(y2, m2, d2)) return { texto: m[0], corto, desde: null, hasta: null }
  return { texto: m[0], corto, desde, hasta: iso(y2, m2, d2) }
}

/** El concepto sin el periodo (ni el separador que lo antecede). */
export function quitarPeriodo(concepto: string): string {
  return concepto.replace(RE_CON_SEPARADOR, '')
}
