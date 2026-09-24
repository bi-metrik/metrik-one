/**
 * El código del TIPO de documento pegado delante del número, y el DV pegado detrás.
 *
 * ── El error ───────────────────────────────────────────────────────────────────────
 * En el RUT de la DIAN la casilla 25 (tipo de documento: «13» = cédula de ciudadanía)
 * va justo a la izquierda de la casilla 26 (número de identificación). La extracción a
 * veces las lee como un solo número: V0521 quedó 1380180688 con la casilla 5 en
 * 80180688; V0254 1379907467, V0110 1379485203, V0395 137556326 (7556326), y V0177
 * 132747706 (32747706: ahí se coló solo el «1»). V0177 llegó a imprimir ese número en la
 * declaración juramentada y la relación de facturas para la DIAN.
 *
 * Con cédula de ciudadanía la casilla 26 ES la casilla 5: para una persona natural el NIT
 * es su cédula. Por eso el testigo de este módulo es siempre OTRA lectura del mismo
 * documento (la casilla 5, otra fuente), nunca la forma del número por sí sola.
 *
 * ── Criterio, estrecho a propósito ─────────────────────────────────────────────────
 * - `13` + X: ninguna cédula de ciudadanía empieza hoy por 13 (las de 10 dígitos van por
 *   10 y 11), así que el «13» delante de otro documento conocido es el código de tipo.
 * - `1` + X solo si el total tiene 9 dígitos o menos (X de hasta 8, una cédula vieja).
 *   Una cédula real de 10 dígitos, 11xxxxxxxx, sin su «1» se parece a otra de 9 que
 *   alguien leyó sin el primer dígito; ahí no se puede saber cuál es la buena, y adivinar
 *   borraría un dígito real. Ese caso NO se limpia: queda para el voto y la persona.
 * - X tiene al menos 6 dígitos y no empieza por 0.
 *
 * Es más estricto que `mismoDocumento` (que acepta cualquier «1» delante para no dar
 * falsos avisos al COMPARAR). Aquí se decide qué valor es el limpio, que es lo que se
 * guarda y se imprime: comparar tolera, corregir no adivina.
 */

import { calcularDvNit } from './nit'

const soloDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/**
 * Si `valor` es `otro` con el código del tipo de documento pegado delante, devuelve `otro`
 * (el número limpio). Si no, `null`.
 */
export function sinPrefijoDeTipo(valor: unknown, otro: unknown): string | null {
  const v = soloDigitos(valor)
  const o = soloDigitos(otro)
  if (o.length < 6 || o.startsWith('0') || v.length <= o.length) return null
  if (v === '13' + o) return o
  if (v === '1' + o && v.length <= 9) return o
  return null
}

/** ¿`valor` es `base` con su dígito de verificación (módulo 11 DIAN) pegado al final? */
export function conDvPegado(valor: unknown, base: unknown): boolean {
  const v = soloDigitos(valor)
  const b = soloDigitos(base)
  if (b.length < 6 || v.length !== b.length + 1 || !v.startsWith(b)) return false
  return v.slice(-1) === calcularDvNit(b)
}

/**
 * El número limpio de `valor` según las demás lecturas del mismo dato: sin el código de
 * tipo delante (`forma: 'prefijo'`) o sin el DV pegado detrás (`forma: 'dv_pegado'`).
 * Las dos a la vez también (`13` + X + DV de X), siempre con otra lectura igual a X.
 * Sin testigo devuelve el valor tal cual (`forma: 'limpio'`).
 */
export function formaLimpia(
  valor: string,
  otras: readonly string[],
): { limpio: string; forma: 'limpio' | 'prefijo' | 'dv_pegado' | 'prefijo_y_dv' } {
  const testigos = otras.map(soloDigitos).filter(o => o && o !== valor)
  for (const o of testigos) if (sinPrefijoDeTipo(valor, o)) return { limpio: o, forma: 'prefijo' }
  for (const o of testigos) if (conDvPegado(valor, o)) return { limpio: o, forma: 'dv_pegado' }
  for (const o of testigos) {
    if (valor.length > 1 && sinPrefijoDeTipo(valor.slice(0, -1), o) && conDvPegado(o + valor.slice(-1), o)) {
      return { limpio: o, forma: 'prefijo_y_dv' }
    }
  }
  return { limpio: valor, forma: 'limpio' }
}

/**
 * ¿El tipo de documento leído (casilla 25) es cédula de ciudadanía? Acepta el nombre
 * («Cédula de Ciudadanía», con o sin tilde) o el código «13».
 */
export function esCedulaDeCiudadania(tipo: unknown): boolean {
  const t = String(tipo ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
  return t.includes('ciudadania') || t === '13' || /^cc\.?$/.test(t)
}

/**
 * ¿La casilla 25 dice OTRO tipo de documento, legible? Con cédula de extranjería,
 * pasaporte o NIT la casilla 26 difiere de la 5 por diseño, y nada de esto aplica.
 * Un tipo vacío o ilegible («1», un solo dígito) no cuenta como otro tipo.
 */
export function esOtroTipoDeDocumento(tipo: unknown): boolean {
  const t = String(tipo ?? '').trim()
  if (!t || /^\d?$/.test(t)) return false
  return !esCedulaDeCiudadania(t)
}

/**
 * `nit_completo` con el DV pegado dos veces: «799074677-7» para el NIT 79907467 con DV 7
 * (28 de 148 RUT de SOENA al 2026-09-14). Devuelve la forma buena «NIT-DV», o `null` si
 * el valor no tiene exactamente esa forma.
 */
export function nitCompletoSinDvDoble(nitCompleto: unknown, nit: unknown): string | null {
  const n = soloDigitos(nit)
  const dv = calcularDvNit(n)
  if (!n || dv == null) return null
  return soloDigitos(nitCompleto) === n + dv + dv ? `${n}-${dv}` : null
}
