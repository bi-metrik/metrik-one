/**
 * Lo que la IA lee de un PDF, verificado contra la capa de texto del mismo PDF.
 *
 * La IA mira la imagen del documento y a veces confunde letras: en V0514 leyó
 * en el correo del cliente la secuencia «RN» como «M» donde el certificado la imprime bien,
 * y lo guardó con confianza 1. El aviso de correo distinto que salió de ahí era falso.
 * Cuando el PDF trae capa de texto, ese texto no se equivoca de letra.
 *
 * Regla (genérica, sin configuración por bloque):
 *
 *  - Solo campos `texto` cuyo VALOR tiene forma de correo, número de documento, VIN o
 *    código de radicado. La forma la decide el valor, no el slug: así sirve a cualquier
 *    bloque sin declararlo.
 *  - Si el valor está tal cual en el texto (sin importar mayúsculas), queda.
 *  - Si no está, pero el texto trae UN candidato del mismo tipo a una o dos confusiones
 *    típicas de lectura (rn↔m, cl↔d, vv↔w, l↔1↔I, O↔0), se guarda el del texto, con lo
 *    que leyó la IA en `leido` y `origen: 'texto_pdf'`.
 *  - Si hay dos candidatos igual de cerca, o ninguno, el valor no se toca.
 *  - Sin capa de texto (un escaneo), no se llama.
 *
 * Un número de documento solo con dígitos nunca se corrige: ninguna confusión de la
 * lista va de dígito a dígito. Para él la regla solo dice si está o no en el texto.
 */

import type { CampoExtraccion, CampoResultado } from './extract-fields'

export type TipoVerificable = 'correo' | 'documento' | 'vin' | 'radicado'

/** Máximo de confusiones para aceptar un candidato del texto. */
export const MAXIMO_CONFUSIONES = 2

const RE_CORREO_VALOR = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RE_CORREO_TEXTO = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const RE_VIN = /^[a-z0-9]{17}$/i
const RE_DOCUMENTO = /^\d{5,15}$/
const RE_RADICADO = /^[a-z0-9][a-z0-9_\-/.]{4,38}[a-z0-9]$/i

const tieneLetra = (s: string) => /[a-z]/i.test(s)
const tieneDigito = (s: string) => /\d/.test(s)

/** Qué tipo de dato es un valor leído, por su forma. `null` = no se verifica. */
export function tipoVerificable(valor: string): TipoVerificable | null {
  const v = valor.trim()
  if (!v || /\s/.test(v)) return null
  if (v.includes('@')) return RE_CORREO_VALOR.test(v) ? 'correo' : null
  if (RE_DOCUMENTO.test(v)) return 'documento'
  if (RE_VIN.test(v) && tieneLetra(v) && tieneDigito(v)) return 'vin'
  if (RE_RADICADO.test(v) && tieneLetra(v) && tieneDigito(v)) return 'radicado'
  return null
}

/** Los dígitos de un número escrito con separadores («1.020.304» o «1 020 304») juntos. */
function juntarDigitos(texto: string): string {
  return texto.replace(/(?<=\d)[.,\s](?=\d)/g, '')
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** ¿El valor está tal cual en el texto? Sin importar mayúsculas. */
export function estaEnTexto(valor: string, tipo: TipoVerificable, texto: string): boolean {
  const v = valor.trim().toLowerCase()
  const t = texto.toLowerCase()
  if (tipo === 'documento') {
    return new RegExp(`(?<!\\d)${escaparRegex(v)}(?!\\d)`).test(juntarDigitos(t))
  }
  // Un correo o un código largo a veces viene partido en dos renglones: se tolera
  // espacio entre sus caracteres, pero no que se pegue a la palabra de al lado.
  const cuerpo = [...v].map(escaparRegex).join('\\s*')
  const antes = tipo === 'correo' ? '[a-z0-9._%+-]' : '[a-z0-9]'
  return new RegExp(`(?<!${antes})${cuerpo}(?![a-z0-9])`).test(t)
}

/** Los valores del mismo tipo que aparecen en el texto. */
export function candidatosEnTexto(texto: string, tipo: TipoVerificable): string[] {
  const set = new Set<string>()
  if (tipo === 'correo') {
    for (const m of texto.matchAll(RE_CORREO_TEXTO)) set.add(m[0].replace(/\.+$/, ''))
  } else if (tipo === 'documento') {
    for (const m of juntarDigitos(texto).matchAll(/\d{5,15}/g)) set.add(m[0])
  } else {
    for (const m of texto.matchAll(/[a-z0-9][a-z0-9_\-/.]*[a-z0-9]/gi)) {
      const s = m[0]
      if (tipoVerificable(s) === tipo) set.add(s)
    }
  }
  return [...set]
}

// ── Confusiones de lectura ──────────────────────────────────────────────────────

/** Letras que se confunden una por otra (en minúscula: I mayúscula es `i`). */
const CLASES_SIMPLES = ['l1i|', 'o0']
/** Grupos que se leen como una sola letra, y viceversa. */
const GRUPOS: Array<[string, string]> = [['rn', 'm'], ['cl', 'd'], ['vv', 'w']]

function mismaClase(a: string, b: string): boolean {
  return CLASES_SIMPLES.some(c => c.includes(a) && c.includes(b))
}

/**
 * Cuántas confusiones típicas separan dos valores (sin importar mayúsculas), o
 * `Infinity` si una diferencia no es una confusión típica. 0 = son iguales.
 */
export function confusionesEntre(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  const n = x.length
  const m = y.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity))
  dp[0][0] = 0
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const d = dp[i][j]
      if (d === Infinity) continue
      if (i < n && j < m) {
        if (x[i] === y[j]) dp[i + 1][j + 1] = Math.min(dp[i + 1][j + 1], d)
        else if (mismaClase(x[i], y[j])) dp[i + 1][j + 1] = Math.min(dp[i + 1][j + 1], d + 1)
      }
      for (const [largo, corto] of GRUPOS) {
        if (x.startsWith(largo, i) && y.startsWith(corto, j)) {
          dp[i + largo.length][j + corto.length] = Math.min(dp[i + largo.length][j + corto.length], d + 1)
        }
        if (x.startsWith(corto, i) && y.startsWith(largo, j)) {
          dp[i + corto.length][j + largo.length] = Math.min(dp[i + corto.length][j + largo.length], d + 1)
        }
      }
    }
  }
  return dp[n][m]
}

// ── La pasada ───────────────────────────────────────────────────────────────────

export interface VerificacionTexto {
  slug: string
  tipo: TipoVerificable
  /** `en_texto`: queda. `corregido`: se tomó el del texto. `ausente`: no está y no hay
   *  un candidato único a pocas confusiones (el valor no se toca). */
  estado: 'en_texto' | 'corregido' | 'ausente'
  leido: string
  valor: string
}

/** El candidato del texto que corrige `valor`, o `null` si no hay uno solo. */
export function candidatoCorrector(valor: string, tipo: TipoVerificable, texto: string): string | null {
  let mejor = Infinity
  let elegidos: string[] = []
  for (const c of candidatosEnTexto(texto, tipo)) {
    const d = confusionesEntre(valor, c)
    if (d < 1 || d > MAXIMO_CONFUSIONES) continue
    if (d < mejor) { mejor = d; elegidos = [c] }
    else if (d === mejor) elegidos.push(c)
  }
  const distintos = [...new Set(elegidos.map(c => c.toLowerCase()))]
  return distintos.length === 1 ? elegidos[0] : null
}

/**
 * Verifica cada campo `texto` verificable contra la capa de texto del PDF. Muta
 * `resultado` en sitio y devuelve qué pasó con cada uno.
 */
export function verificarContraTexto(
  campos: CampoExtraccion[],
  resultado: Record<string, CampoResultado>,
  texto: string,
): VerificacionTexto[] {
  const salida: VerificacionTexto[] = []
  for (const campo of campos) {
    if (campo.tipo !== 'texto') continue
    const cr = resultado[campo.slug]
    if (!cr?.value || cr.edicion) continue
    const tipo = tipoVerificable(cr.value)
    if (!tipo) continue
    const leido = cr.value
    if (estaEnTexto(leido, tipo, texto)) {
      salida.push({ slug: campo.slug, tipo, estado: 'en_texto', leido, valor: leido })
      continue
    }
    const candidato = candidatoCorrector(leido, tipo, texto)
    if (!candidato) {
      salida.push({ slug: campo.slug, tipo, estado: 'ausente', leido, valor: leido })
      continue
    }
    // El correo se guarda en minúsculas, como lo pide la extracción; el resto, tal cual
    // está impreso.
    const valor = tipo === 'correo' ? candidato.toLowerCase() : candidato
    cr.value = valor
    cr.leido = leido
    cr.origen = 'texto_pdf'
    salida.push({ slug: campo.slug, tipo, estado: 'corregido', leido, valor })
  }
  return salida
}
