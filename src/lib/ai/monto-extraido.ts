import { parseMontoCop } from '@/lib/negocios/monto-cop'

/**
 * Normaliza el valor que el extractor de documentos lee para un campo `currency`:
 * pesos enteros como texto ("1500000"). Solo lo usan los campos `currency`; los
 * `numero` (porcentajes, cantidades, años) no pasan por aquí.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 *
 * 1. Se quitan `$` y espacios.
 * 2. Si el texto es una agrupación de MILES CON COMA —`1,500,000`, `350,906`,
 *    `1,234,567.89`— se lee como tal: las comas son miles y un punto final es decimal.
 *    La forma exacta es `^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$`.
 * 3. Todo lo demás se lee con la regla colombiana de antes, sin cambio alguno.
 * 4. Se redondea al peso. Si no sale un número, el valor queda como llegó.
 *
 * ⚠️ POR QUÉ EL PASO 2
 *
 * La regla de antes trataba TODA coma sola como decimal y, con punto y coma juntos,
 * asumía siempre el formato colombiano. Con miles escritos con coma (el formato de
 * EE. UU., que el modelo a veces devuelve aunque el prompt pida el entero limpio):
 *
 *     "1,500,000"    → 2        (se leía 1,5)
 *     "1,234,567.89" → 1        (se leía 1,234)
 *     "350,906"      → 351      (se leía 350,906 pesos)
 *
 * El caso `350,906` es el único ambiguo: en notación colombiana sería 350 pesos con
 * 906 milésimas. Se lee como MILES, igual que `parseMontoCop` (#839): en pesos no
 * existen las milésimas, y un monto de documento con tres decimales no aparece. Se
 * exige que el primer grupo no empiece por 0, así que `0,190` sigue leyéndose como
 * antes (0,19).
 *
 * El paso 2 no toca nada más: ningún texto que no tenga esa forma exacta cambia de
 * resultado. Por eso no se reemplazó la regla entera por `parseMontoCop`: con otras
 * entradas (un `$` antes del signo menos, un número entre paréntesis, texto con
 * letras) las dos difieren, y aquí manda no mover lo que ya se leía.
 */
const MILES_CON_COMA = /^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/

export function normalizarMontoExtraido(value: string): string {
  let cleaned = value.replace(/[$\s]/g, '')

  if (MILES_CON_COMA.test(cleaned)) {
    const n = parseMontoCop(cleaned)
    return n === null ? value : String(Math.round(n))
  }

  // ── Regla colombiana de antes, sin cambio ─────────────────────────────────
  // Punto y coma juntos: "1.500.000,50" → puntos de miles, coma decimal.
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  }
  // Solo puntos, varios: "1.500.000" → separadores de miles.
  else if ((cleaned.match(/\./g) || []).length > 1) {
    cleaned = cleaned.replace(/\./g, '')
  }
  // Un solo punto: con exactamente 3 dígitos detrás es de miles ("1.500"); si no, decimal.
  else if (cleaned.includes('.')) {
    const afterDot = cleaned.split('.')[1]
    if (afterDot && afterDot.length === 3) {
      cleaned = cleaned.replace('.', '')
    }
  }
  // Solo coma: decimal ("1500,50").
  else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.')
  }
  const num = parseFloat(cleaned)
  return isNaN(num) ? value : String(Math.round(num))
}
