import { canonizarSeccional } from './seccionales'

/**
 * Las cinco columnas en las que JD lee su Sheet "Directivo SOENA".
 *
 * ⚠️ Esto NO reemplaza el corte por seccional del tablero Comercial. Mauricio cerro
 * el 2026-08-22 que ahi las seccionales van **tal cual**, sin agrupar, y esa decision
 * sigue en pie. La agrupacion vive aqui, aparte y con nombre propio, porque es el
 * idioma de UNA vista: el directivo. Meterla en `canonizarSeccional` la volveria la
 * regla de todo el producto.
 */
export const COLUMNAS_DIRECTIVO = [
  'Bogotá',
  'Cali',
  'Medellín',
  'Bucaramanga',
  'Otras ciudades',
  'Sin seccional',
] as const

export type ColumnaDirectivo = (typeof COLUMNAS_DIRECTIVO)[number]

/** Las cuatro que JD nombra una por una. El resto cae en "Otras ciudades". */
const NOMBRADAS = new Set(['Bogotá', 'Cali', 'Medellín', 'Bucaramanga'])

/**
 * Seccional cruda de la base -> columna del tablero directivo.
 *
 * "Sin seccional" es una columna visible, no un descarte: hoy son 92 casos, y 73 de
 * ellos estan en Validacion o Propuesta, donde el RUT todavia no ha llegado. Repartirlos
 * a prorrata inventaria una distribucion que nadie midio; esconderlos dejaria las
 * columnas sin sumar el total sin decir por que.
 */
export function columnaDirectivo(seccional: string | null | undefined): ColumnaDirectivo {
  if (!seccional || seccional === '(sin seccional)') return 'Sin seccional'
  const canonica = canonizarSeccional(seccional)
  if (!canonica) return 'Sin seccional'
  return NOMBRADAS.has(canonica) ? (canonica as ColumnaDirectivo) : 'Otras ciudades'
}
