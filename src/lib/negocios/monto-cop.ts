/**
 * Lectura de un monto en pesos colombianos escrito por humanos o por la IA.
 *
 * ⚠️ POR QUÉ NO SIRVE `replace(/[^\d]/g, '')`
 *
 * Quitar todo lo que no sea dígito parece razonable y está mal: en Colombia el
 * PUNTO es separador de miles, pero un valor guardado en jsonb puede traer punto
 * DECIMAL. El mismo carácter significa dos cosas opuestas.
 *
 *     "$ 701.812"   → miles   → 701812
 *     "350906.00"   → decimal → 350906   (con el regex daría 35090600, ×100)
 *
 * Pasó de verdad el 2026-08-02 auditando la tarifa UPME: los valores derivados del
 * cobro se habían guardado con decimales, y una consulta con ese regex reportó la
 * tarifa de un negocio como $35 millones en vez de $350.906. El error no rompe
 * nada visiblemente — devuelve un número plausible, cien veces más grande.
 *
 * REGLA (formato colombiano, tolerante a lo que escriba la IA):
 *  1. Se conservan solo dígitos, puntos y comas (fuera `$`, espacios, `COP`, signos).
 *  2. Si aparecen AMBOS separadores, el ÚLTIMO en aparecer es el decimal.
 *  3. Si aparece uno solo: es DECIMAL si deja 1 o 2 dígitos al final y aparece una
 *     sola vez; en cualquier otro caso es separador de miles.
 *     - "350906.00" → decimal (2 dígitos)     - "701.812"     → miles (3 dígitos)
 *     - "1.234.567" → miles (aparece 2 veces) - "1234,5"      → decimal
 *
 * El caso "1.234" es genuinamente ambiguo (¿mil doscientos treinta y cuatro, o uno
 * con 234 milésimas?). Se resuelve como MILES: en pesos colombianos los decimales
 * de tres dígitos no existen en la práctica y el separador de miles sí.
 */

/**
 * Convierte a número. Devuelve `null` si no hay un monto legible, para que quien
 * llame decida qué hacer — NO 0, que se confundiría con un monto real de cero.
 */
export function parseMontoCop(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (valor === null || valor === undefined) return null

  const bruto = String(valor).trim()
  if (!bruto) return null

  const negativo = /^\(.*\)$/.test(bruto) || bruto.startsWith('-')
  const limpio = bruto.replace(/[^\d.,]/g, '')
  if (!limpio || !/\d/.test(limpio)) return null

  const ultimoPunto = limpio.lastIndexOf('.')
  const ultimaComa = limpio.lastIndexOf(',')

  let sepDecimal = -1
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    sepDecimal = Math.max(ultimoPunto, ultimaComa)
  } else if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const pos = Math.max(ultimoPunto, ultimaComa)
    const sep = limpio[pos]
    const decimales = limpio.length - pos - 1
    const apariciones = limpio.split(sep).length - 1
    if (apariciones === 1 && decimales >= 1 && decimales <= 2) sepDecimal = pos
  }

  const entera = (sepDecimal >= 0 ? limpio.slice(0, sepDecimal) : limpio).replace(/[.,]/g, '')
  const decimal = sepDecimal >= 0 ? limpio.slice(sepDecimal + 1).replace(/[.,]/g, '') : ''
  if (!entera && !decimal) return null

  const n = Number(`${entera || '0'}.${decimal || '0'}`)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

/**
 * ¿Dos montos son el mismo, dentro de la tolerancia de materialidad?
 *
 * La tolerancia NO es un detalle: comparar dinero al peso exacto convierte cualquier
 * redondeo legítimo en una alerta, y una alerta que salta siempre deja de leerse.
 * Casos reales de SOENA: V0253 pagó $773.564 contra una referencia de $773.316
 * ($248 de diferencia) y V0049 pagó $700.000 contra $701.812 ($1.812).
 *
 * Por defecto usa el piso de materialidad de Carmen (`TOLERANCIA_SALDO_COP`, $1.000),
 * el mismo que ya aplican los gates de saldo. Configurable por check con
 * `tolerancia_cop` cuando un documento exija más o menos margen.
 */
export function montosCoinciden(
  esperado: unknown,
  extraido: unknown,
  toleranciaCop: number,
): boolean {
  const a = parseMontoCop(esperado)
  const b = parseMontoCop(extraido)
  // Sin uno de los dos lados no hay comparación posible: el check no pasa, pero
  // tampoco afirma un descuadre. Quien llama ya decide si eso alerta o no.
  if (a === null || b === null) return false
  const margen = Number.isFinite(toleranciaCop) && toleranciaCop >= 0 ? toleranciaCop : 0
  return Math.abs(a - b) <= margen
}
