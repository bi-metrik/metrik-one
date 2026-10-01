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
 *
 * Desde el 2026-10-01 las dos validaciones comparten la normalización
 * (`texto-normalizado.ts`) y la regla de nombres (`nombresCoinciden`): la de
 * `documento-actions.ts` vive ahora en `documentos/comparar-check.ts` y usa estas.
 */

import { direccionesCoinciden } from './direccion-predio'
import { montosCoinciden } from './monto-cop'
import { normalizarTexto } from './texto-normalizado'
import { TOLERANCIA_SALDO_COP } from './tolerancia-saldo'

/**
 * - `tokens`: el mismo nombre de persona, en cualquier orden. Ver `nombresCoinciden`.
 * - `contenido`: las palabras de uno están todas en el otro (razón social con o sin sigla).
 * - `palabra_comun`: comparten al menos una palabra con letras (marca, línea).
 * - `compacto`: iguales sin espacios ni signos (VIN, placas, series).
 * - `monto`: el mismo número de pesos, con tolerancia.
 * - `correo`: la misma dirección, sin mayúsculas ni espacios. Una letra distinta es otra
 *   dirección (el certificado de V0210 dice «hotmaiol.com»). Lo único que se tolera son los
 *   pares que la lectura de un PDF confunde: «1» con «l» y «0» con «o». Medido el 24-sep
 *   en 315 certificados: la IA leyó «diegotamayol» donde el PDF dice «diegotamayo1» (V0208).
 * - `direccion`: el mismo predio en una dirección colombiana. Ver `./direccion-predio`.
 */
export type ModoComparacion = 'tokens' | 'contenido' | 'palabra_comun' | 'compacto' | 'monto' | 'correo' | 'direccion'

export const MODOS_COMPARACION: ModoComparacion[] = [
  'tokens', 'contenido', 'palabra_comun', 'compacto', 'monto', 'correo', 'direccion',
]

/** «1»→«l» y «0»→«o»: los caracteres que una lectura por imagen confunde en un correo. */
function plegarConfusiones(correo: string): string {
  return correo.replace(/1/g, 'l').replace(/0/g, 'o')
}

/** Un correo para comparar: minúsculas, sin espacios (la extracción los parte) ni `mailto:`. */
export function normalizarCorreo(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^mailto:/, '')
}

export interface OpcionesComparacion {
  /** Solo `monto`. Por defecto el piso de materialidad ($1.000). */
  tolerancia_cop?: number
  /**
   * Grupos de palabras que valen lo mismo, ya normalizadas: `[["deepal", "changan"]]`
   * (Deepal es una marca de Changan y el certificado usa una y la factura otra).
   */
  equivalencias?: string[][]
}

const normalizar = normalizarTexto

/**
 * ¿El mismo nombre de persona? Las palabras, sin orden, sin tildes ni signos.
 *
 * Coincide si son las mismas, o si a uno le falta UNA sola de las del otro y comparten
 * al menos tres. Es la forma en que el mismo nombre llega distinto de dos papeles: el RUT
 * leído en ONE de V0521 trae «ALARCON  WILSON ALEXANDER» (sin el segundo apellido) y el
 * certificado y la factura «ALARCON CARRASQUILLA WILSON ALEXANDER».
 *
 * Por qué tres en común y no menos: dos personas distintas comparten con facilidad un
 * apellido, y una pareja o dos hermanos comparten dos palabras («GOMEZ PEREZ ANA» y
 * «GOMEZ PEREZ LUIS»), pero en esos casos a cada lado le sobra una palabra que el otro no
 * tiene, y eso NO coincide. Lo único que se tolera es que un lado sea el otro con una
 * palabra menos. Que sea la misma persona lo confirma el número de documento, que tiene
 * su propio cruce: el nombre solo no distingue a dos homónimos.
 */
export function nombresCoinciden(a: unknown, b: unknown, equivalencias: string[][] = []): boolean {
  const x = palabras(a, equivalencias)
  const y = palabras(b, equivalencias)
  if (x.size === 0 || y.size === 0) return false
  const [corto, largo] = x.size <= y.size ? [x, y] : [y, x]
  if (![...corto].every(p => largo.has(p))) return false
  return largo.size === corto.size || (largo.size - corto.size === 1 && corto.size >= 3)
}

/**
 * Las palabras más las parejas de palabras seguidas pegadas: «RAV 4» trae también
 * «rav4», y «X5 XDRIVE 50E» trae «xdrive50e». Un modelo de carro se escribe con y sin
 * espacio según el papel (medido en SOENA: RAV4, X5 xDrive50e, EQA 250+).
 */
function conPegadas(texto: string): string[] {
  const ps = texto.split(' ').filter(Boolean)
  const out = [...ps]
  for (let i = 0; i + 1 < ps.length; i++) out.push(ps[i] + ps[i + 1])
  return out
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
  if (modo === 'correo') {
    const x = normalizarCorreo(a)
    return x.includes('@') && plegarConfusiones(x) === plegarConfusiones(normalizarCorreo(b))
  }
  if (modo === 'direccion') return direccionesCoinciden(a, b)
  if (modo === 'compacto') {
    const x = normalizar(a).replace(/\s/g, '')
    const y = normalizar(b).replace(/\s/g, '')
    return !!x && x === y
  }
  if (modo === 'tokens') return nombresCoinciden(a, b, opts.equivalencias)
  const x = palabras(a, opts.equivalencias)
  const y = palabras(b, opts.equivalencias)
  if (x.size === 0 || y.size === 0) return false
  if (modo === 'contenido') return [...x].every(p => y.has(p)) || [...y].every(p => x.has(p))
  // palabra_comun: una palabra con letras, de 2 o más caracteres. Los números solos (el
  // año del modelo) no cuentan: dos carros distintos del mismo año no son el mismo carro.
  // El mismo texto siempre coincide, aunque sea una sola letra (el modelo «X»).
  if (normalizar(a) === normalizar(b)) return true
  const conLetras = (s: Set<string>) =>
    conPegadas([...s].join(' ')).filter(p => p.length >= 2 && /[a-z]/.test(p))
  const ys = new Set(conLetras(y))
  return conLetras(x).some(p => ys.has(p))
}
