/**
 * Cómo se escriben las cifras y las fechas de las obras (cierre, facturas, llegadas, PDF y CSV).
 *
 * Pesos colombianos sin decimales y SIN espacio después del signo: `$1.850.000`. Se arma a mano
 * en vez de con `Intl.NumberFormat(..., { style: 'currency' })`, que según el ICU del entorno
 * pone un espacio duro entre el signo y la cifra: la pantalla y el PDF tienen que decir lo mismo.
 */
import { formatFecha, formatBogotaFechaCortaAno, type FechaInput } from '@/lib/dates/bogota'

function agrupar(entero: number): string {
  return String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** `$1.850.000`; negativo `-$1.850.000`. Un valor que no es número sale como `$0`. */
export function pesos(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '$0'
  const r = Math.round(v)
  return `${r < 0 ? '-' : ''}$${agrupar(Math.abs(r))}`
}

/** `44 %` a partir de una fracción (0,44). `null` → `—`. */
export function porcentaje(fraccion: number | null | undefined): string {
  if (fraccion === null || fraccion === undefined || !Number.isFinite(fraccion)) return '—'
  return `${Math.round(fraccion * 100)} %`
}

/** Número con coma decimal y sin ceros de más: 38 → `38`, 12.5 → `12,5`. */
export function numeroCorto(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0'
  const r = Math.round(v * 100) / 100
  return Number.isInteger(r) ? agrupar(r) : String(r).replace('.', ',')
}

/** `38 jornadas`, `1 jornada`, `12,5 jornadas`. */
export function textoJornadas(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return `${numeroCorto(v)} ${v === 1 ? 'jornada' : 'jornadas'}`
}

/** `21 oct 2026` (fecha civil o instante, leído en Bogotá). */
export function fechaLegible(v: FechaInput): string {
  return formatBogotaFechaCortaAno(v) ?? '—'
}

/** `7:12 a. m.` en hora de Bogotá. */
export function horaLegible(v: FechaInput): string {
  return formatFecha(v, { hour: 'numeric', minute: '2-digit' }) ?? '—'
}

/** `07:12` (24 h, Bogotá), para precargar un `<input type="time">`. */
export function horaParaCampo(v: FechaInput): string {
  const s = formatFecha(v, { hour: '2-digit', minute: '2-digit', hour12: false })
  if (!s) return ''
  const m = /(\d{1,2}):(\d{2})/.exec(s)
  return m ? `${m[1].padStart(2, '0').replace(/^24/, '00')}:${m[2]}` : ''
}
