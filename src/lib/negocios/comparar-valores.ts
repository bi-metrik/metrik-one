/**
 * ¿Dos valores del negocio dicen lo mismo? Las comparaciones que usan los cruces de la
 * línea entre dos documentos (el certificado UPME contra la factura y el RUT).
 *
 * Puro y sin servidor: el `cross_check` que corre al cargar un documento tiene sus
 * propias comparaciones dentro de `documento-actions.ts` (un archivo `'use server'` no
 * puede exportarlas). Estas se escribieron midiendo contra los certificados reales de
 * SOENA del 2026-09-24, y por eso no copian dos defectos de aquellas:
 *
 * - `overlap` exigía palabras de 3 letras o más: «MG» contra «MG» daba NO coincide (4 de
 *   315 certificados). Aquí basta con 2 letras.
 * - `tokens` comparaba listas ordenadas: un nombre repetido («MAURICIO MAURICIO AFANADOR
 *   BARRIOS» contra «AFANADOR BARRIOS MAURICIO») daba NO coincide. Aquí son conjuntos.
 */

import { montosCoinciden } from './monto-cop'
import { TOLERANCIA_SALDO_COP } from './tolerancia-saldo'

/**
 * - `tokens`: las mismas palabras, en cualquier orden (nombres de personas).
 * - `contenido`: las palabras de uno están todas en el otro (razón social con o sin sigla).
 * - `palabra_comun`: comparten al menos una palabra con letras (marca, línea).
 * - `compacto`: iguales sin espacios ni signos (VIN, placas, series).
 * - `monto`: el mismo número de pesos, con tolerancia.
 */
export type ModoComparacion = 'tokens' | 'contenido' | 'palabra_comun' | 'compacto' | 'monto'

export const MODOS_COMPARACION: ModoComparacion[] = ['tokens', 'contenido', 'palabra_comun', 'compacto', 'monto']

export interface OpcionesComparacion {
  /** Solo `monto`. Por defecto el piso de materialidad ($1.000). */
  tolerancia_cop?: number
  /**
   * Grupos de palabras que valen lo mismo, ya normalizadas: `[["deepal", "changan"]]`
   * (Deepal es una marca de Changan y el certificado usa una y la factura otra).
   */
  equivalencias?: string[][]
}

function normalizar(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function palabras(v: unknown, equivalencias: string[][] = []): Set<string> {
  const canon = new Map<string, string>()
  for (const grupo of equivalencias) {
    const norm = grupo.map(normalizar).filter(Boolean)
    for (const p of norm) canon.set(p, norm[0])
  }
  return new Set(
    normalizar(v)
      .split(' ')
      .filter(Boolean)
      .map(p => canon.get(p) ?? p),
  )
}

/** ¿Coinciden? `false` también cuando falta uno de los dos: quien llama decide si calla. */
export function coinciden(a: unknown, b: unknown, modo: ModoComparacion, opts: OpcionesComparacion = {}): boolean {
  if (modo === 'monto') return montosCoinciden(a, b, opts.tolerancia_cop ?? TOLERANCIA_SALDO_COP)
  if (modo === 'compacto') {
    const x = normalizar(a).replace(/\s/g, '')
    const y = normalizar(b).replace(/\s/g, '')
    return !!x && x === y
  }
  const x = palabras(a, opts.equivalencias)
  const y = palabras(b, opts.equivalencias)
  if (x.size === 0 || y.size === 0) return false
  if (modo === 'tokens') return x.size === y.size && [...x].every(p => y.has(p))
  if (modo === 'contenido') return [...x].every(p => y.has(p)) || [...y].every(p => x.has(p))
  // palabra_comun: una palabra con letras, de 2 o más caracteres. Los números solos (el
  // año del modelo) no cuentan: dos carros distintos del mismo año no son el mismo carro.
  const conLetras = (s: Set<string>) => [...s].filter(p => p.length >= 2 && /[a-z]/.test(p))
  const ys = new Set(conLetras(y))
  return conLetras(x).some(p => ys.has(p))
}
