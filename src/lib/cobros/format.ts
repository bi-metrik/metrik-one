/**
 * Helpers de formato para cuentas de cobro:
 *   - formatCOP: '$1.750.000'
 *   - formatFechaLetras: '15 de mayo de 2026'
 *   - numeroALetras: 'Un millón setecientos cincuenta mil pesos colombianos (COP $1.750.000).'
 *
 * Sin dependencias externas — implementado en TS puro para minimizar bundle.
 */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

/**
 * Formatea un número en COP con punto separador de miles, sin decimales.
 *   1750000 -> '$1.750.000'
 *   416667  -> '$416.667'
 */
export function formatCOP(monto: number): string {
  const entero = Math.round(monto)
  const formatted = entero.toLocaleString('es-CO', { useGrouping: true })
  return `$${formatted}`
}

/**
 * Formatea fecha en letras estilo español Colombia:
 *   new Date('2026-05-15') -> '15 de mayo de 2026'
 *
 * IMPORTANTE: maneja fechas como strings 'YYYY-MM-DD' parseándolas en UTC para
 * evitar drift por timezone local (issue común en JS).
 */
export function formatFechaLetras(fecha: Date | string): string {
  let d: Date
  if (typeof fecha === 'string') {
    // Parsear YYYY-MM-DD como UTC mediodía para evitar drift
    const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) {
      d = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12))
    } else {
      d = new Date(fecha)
    }
  } else {
    d = fecha
  }
  const dia = d.getUTCDate()
  const mes = MESES[d.getUTCMonth()]
  const año = d.getUTCFullYear()
  return `${dia} de ${mes} de ${año}`
}

// ── Número a letras (es-CO) ────────────────────────────────────────────────

const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
const DECENAS_10 = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve']
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function unidadesYDecenas(n: number): string {
  if (n === 0) return ''
  if (n < 10) return UNIDADES[n]
  if (n < 20) return DECENAS_10[n - 10]
  if (n === 20) return 'veinte'
  if (n < 30) return 'veinti' + UNIDADES[n - 20]
  const d = Math.floor(n / 10)
  const u = n % 10
  return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${UNIDADES[u]}`
}

function centenas(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const resto = n % 100
  if (c === 0) return unidadesYDecenas(resto)
  return resto === 0 ? CENTENAS[c] : `${CENTENAS[c]} ${unidadesYDecenas(resto)}`
}

function miles(n: number): string {
  if (n === 0) return ''
  if (n < 1000) return centenas(n)
  const m = Math.floor(n / 1000)
  const resto = n % 1000
  let txt: string
  if (m === 1) txt = 'mil'
  else txt = `${centenas(m)} mil`
  return resto === 0 ? txt : `${txt} ${centenas(resto)}`
}

function millones(n: number): string {
  if (n === 0) return ''
  if (n < 1_000_000) return miles(n)
  const mm = Math.floor(n / 1_000_000)
  const resto = n % 1_000_000
  let txt: string
  if (mm === 1) txt = 'un millón'
  else txt = `${miles(mm)} millones`
  return resto === 0 ? txt : `${txt} ${miles(resto)}`
}

/**
 * Convierte un número entero a letras en español (Colombia).
 *
 * Ej:
 *   1750000 -> 'un millón setecientos cincuenta mil'
 *   816667  -> 'ochocientos dieciséis mil seiscientos sesenta y siete'
 *   400000  -> 'cuatrocientos mil'
 */
export function numeroALetras(n: number): string {
  if (n === 0) return 'cero'
  const txt = millones(Math.abs(Math.round(n)))
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}

/**
 * Devuelve frase completa de monto en letras COP:
 *   1750000 -> 'Un millón setecientos cincuenta mil pesos colombianos (COP $1.750.000).'
 */
export function montoEnLetrasCOP(monto: number): string {
  const letras = numeroALetras(monto)
  const formato = formatCOP(monto)
  return `${letras} pesos colombianos (COP ${formato}).`
}
