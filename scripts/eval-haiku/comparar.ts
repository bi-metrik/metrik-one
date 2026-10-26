/**
 * Comparación de lo que devolvió Haiku contra el oráculo (lo que quedó guardado en producción). Pura.
 * Tolerante a forma, no a fondo: tildes, mayúsculas, espacios, puntuación y separadores de miles no cuentan; un
 * número distinto o una palabra distinta sí.
 */

export interface ComparacionCampo {
  campo: string
  esperado: unknown
  obtenido: unknown
  ok: boolean
  /** El oráculo es una corrección humana (no la salida de Gemini aceptada). */
  corregidoPorHumano?: boolean
}

const vacio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

export function normalizarTexto(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ@]+/g, ' ')
    .trim()
}

function comoNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/[$\s]/g, '')
  if (!/^-?[\d.,]+$/.test(s)) return null
  // «1.234.567» y «1,234,567» son miles; «1234,5» y «1234.5» decimales.
  const sinMiles = /^-?\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, '') : s.replace(',', '.')
  const n = Number(sinMiles)
  return Number.isFinite(n) ? n : null
}

function comoBooleano(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  const t = normalizarTexto(v)
  if (['true', 'si', 'yes', '1'].includes(t)) return true
  if (['false', 'no', '0'].includes(t)) return false
  return null
}

export function valoresIguales(esperado: unknown, obtenido: unknown): boolean {
  if (vacio(esperado) && vacio(obtenido)) return true
  if (vacio(esperado) !== vacio(obtenido)) return false
  const be = comoBooleano(esperado)
  const bo = comoBooleano(obtenido)
  if (typeof esperado === 'boolean' || typeof obtenido === 'boolean') return be !== null && be === bo
  const ne = comoNumero(esperado)
  const no = comoNumero(obtenido)
  if (ne !== null && no !== null) return Math.abs(ne - no) < 0.005
  // Documentos (NIT, cédula, teléfono): solo dígitos.
  const de = String(esperado).replace(/\D/g, '')
  const dob = String(obtenido).replace(/\D/g, '')
  if (de.length >= 6 && de.length / String(esperado).replace(/\s/g, '').length > 0.8) return de === dob
  return normalizarTexto(esperado) === normalizarTexto(obtenido)
}

export function comparar(campo: string, esperado: unknown, obtenido: unknown, corregidoPorHumano?: boolean): ComparacionCampo {
  return { campo, esperado, obtenido, ok: valoresIguales(esperado, obtenido), ...(corregidoPorHumano !== undefined ? { corregidoPorHumano } : {}) }
}

/** Parecido de dos textos libres (resumen de un acta): Jaccard de palabras de 4+ letras. */
export function parecido(a: string, b: string): number {
  const palabras = (s: string) => new Set(normalizarTexto(s).split(' ').filter((w) => w.length >= 4))
  const A = palabras(a)
  const B = palabras(b)
  if (!A.size && !B.size) return 1
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter)
}
