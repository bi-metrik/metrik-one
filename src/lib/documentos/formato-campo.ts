/**
 * Formato de un campo de documento escrito A MANO, antes de guardarlo.
 *
 * Por qué existe (SOE-038, 2026-11-05): ONE daba por completo un documento con un NIT «1»,
 * una fecha «1», un número de factura «0» o una partida arancelaria «X». La persona escribía
 * un relleno para destrabar el bloque y el dato malo quedaba como bueno. Siete facturas de
 * SOENA quedaron completas así.
 *
 * Reglas, en este orden:
 *  1. Vacío siempre pasa: borrar un campo es legítimo y la completitud ya lo frena.
 *  2. `valor_fijo` (opt-in en la config del campo): el valor tiene que ser exactamente ese.
 *  3. Por tipo (genérico, sin opt-in):
 *     - `fecha`: se aceptan las formas que la gente escribe de verdad (2026-09-21, 21/9/2026,
 *       21/9/26, 21-09-26, «24 septiembre 2026») y se GUARDA en AAAA-MM-DD. Lo que no se
 *       puede leer como una fecha real del calendario no se guarda.
 *     - `numero` y `currency`: tiene que ser un número (acepta $, puntos de miles y coma
 *       decimal, y lo guarda sin formato).
 *  4. NIT por nombre del campo (`nit`, `nit_*`, `*_nit`): al menos 6 dígitos. No aplica al DV.
 *  5. `min_caracteres` (opt-in): largo mínimo sin espacios en los bordes.
 *
 * Puro y sin dependencias de servidor: lo usan la pantalla (para avisar en el campo antes de
 * mandar nada) y `actualizarCampoDocumento` (la barrera real).
 */

import type { CampoExtraccion } from '@/lib/ai/extract-fields'

export type FormatoCampo =
  | { ok: true; valor: string }
  | { ok: false; mensaje: string }

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9,
  oct: 10, nov: 11, dic: 12,
}

function dos(n: number): string {
  return String(n).padStart(2, '0')
}

function fechaReal(a: number, m: number, d: number): string | null {
  if (a < 1900 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  // Se arma en UTC a mediodía para que el huso no corra el día (gotcha de `new Date('AAAA-MM-DD')`).
  const f = new Date(Date.UTC(a, m - 1, d, 12))
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null
  return `${a}-${dos(m)}-${dos(d)}`
}

function anio(txt: string): number {
  const n = Number(txt)
  return txt.length === 2 ? 2000 + n : n
}

/** Una fecha escrita a mano, en AAAA-MM-DD; `null` si no es una fecha real. */
export function normalizarFecha(texto: string): string | null {
  const t = texto.trim().toLowerCase()
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ t]\d{1,2}:\d{2}(?::\d{2})?)?$/)
  if (m) return fechaReal(Number(m[1]), Number(m[2]), Number(m[3]))
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)
  if (m) return fechaReal(anio(m[3]), Number(m[2]), Number(m[1]))
  m = t.normalize('NFD').replace(/[̀-ͯ]/g, '').match(/^(\d{1,2})(?:\s+de)?\s+([a-z]+)\.?(?:\s+de|\s+del)?\s+(\d{4})$/)
  if (m && MESES[m[2]]) return fechaReal(Number(m[3]), MESES[m[2]], Number(m[1]))
  return null
}

/** Un número escrito a mano ("$154.990.000,00", "1.500", "12,5"), sin formato; `null` si no lo es. */
export function normalizarNumero(texto: string): string | null {
  let t = texto.trim().replace(/[$\s]/g, '')
  if (!t) return null
  // Coma = decimal; punto = miles (forma colombiana). Un solo punto con 1-2 decimales y sin
  // coma se toma como decimal ("12.5").
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return String(Number(t))
}

/** ¿El campo es un NIT? Por el nombre: `nit`, `nit_proveedor`, `emisor_nit`. Nunca el DV. */
export function esCampoNit(slug: string): boolean {
  return /(^|_)nit($|_)/.test(slug.toLowerCase())
}

export function validarFormatoCampo(config: CampoExtraccion, texto: string): FormatoCampo {
  const valor = texto.trim()
  if (!valor) return { ok: true, valor: '' }

  if (config.valor_fijo !== undefined && config.valor_fijo !== null) {
    if (valor !== config.valor_fijo) {
      return { ok: false, mensaje: `${config.label}: este campo siempre es «${config.valor_fijo}»` }
    }
    return { ok: true, valor }
  }

  let salida = valor
  if (config.tipo === 'fecha') {
    const f = normalizarFecha(valor)
    if (!f) return { ok: false, mensaje: `${config.label}: escribe una fecha completa, por ejemplo 2026-03-17 o 17/03/2026` }
    salida = f
  } else if (config.tipo === 'numero' || config.tipo === 'currency') {
    const n = normalizarNumero(valor)
    if (n === null) return { ok: false, mensaje: `${config.label}: escribe solo el número` }
    salida = n
  }

  if (esCampoNit(config.slug) && salida.replace(/\D/g, '').length < 6) {
    return { ok: false, mensaje: `${config.label}: un NIT tiene al menos 6 dígitos` }
  }

  if (config.min_caracteres && salida.length < config.min_caracteres) {
    return { ok: false, mensaje: `${config.label}: escribe el dato completo (mínimo ${config.min_caracteres} caracteres)` }
  }

  return { ok: true, valor: salida }
}
