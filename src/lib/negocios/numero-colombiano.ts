/**
 * Leer un número escrito por una persona en Colombia.
 *
 * FUENTE ÚNICA del criterio con que un campo `tipo: 'numero'` de un bloque `datos`
 * convierte lo tecleado en el número que se guarda. La usan el input (al escribir) y
 * el servidor (al recibir), para que los dos entiendan lo mismo.
 *
 * ⚠️ POR QUÉ EXISTE ESTE ARCHIVO
 *
 * El campo se rendía con `<input type="number">` y el valor se tomaba con
 * `Number(e.target.value)`. En Colombia el separador de miles es el PUNTO, así que
 * `769.898` —la forma normal de escribir setecientos sesenta y nueve mil— es para
 * `Number()` un decimal: **769,898 pesos**. El navegador no se queja (un `type=number`
 * sin `step` marca el valor como inválido por paso, pero esa validación solo se ve al
 * enviar un formulario, y aquí no hay formulario) y el número entra a la base.
 *
 * Medido en SOENA el 2026-09-15 sobre las 235 confirmaciones de tarifa UPME: CUATRO
 * casos abiertos guardados así (V0497 `769.898` con referencia 770.159, V0264, V0475 y
 * V0301). En V0498, ya corregido a mano, el efecto encadenado fue: el valor a recaudar
 * bajó de $1.195.159 a $425.769, el negocio figuró con $556.628 de sobrante en
 * conciliación, el gate de handoff dio por cuadrado un caso que no lo estaba y el PDF
 * que recibió el cliente llevó la cifra mala.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 *
 * Se escribe en Colombia, se lee en Colombia:
 *
 *   · Hay coma        → la coma es el decimal y los puntos son miles.  `1.234,56` → 1234.56
 *   · Solo puntos     → son separadores de miles SI cada grupo después del primer punto
 *                       tiene exactamente tres dígitos.                `769.898`   → 769898
 *                                                                      `1.234.567` → 1234567
 *   · Un punto con 1, 2 o 4+ dígitos detrás → es un decimal.           `45.5`      → 45.5
 *                                                                      `0.65`      → 0.65
 *
 * La ambigüedad real es una sola: un punto seguido de exactamente tres dígitos
 * (`45.500`). Ahí gana la convención colombiana (miles), que es lo que la gente escribe
 * y lo que el formato de salida del propio producto imprime. Los campos `numero` que hoy
 * existen y admiten decimales son porcentajes de margen, un divisor y el rendimiento en
 * km/galón: ninguno se escribe con tres decimales, así que la ambigüedad no los toca.
 *
 * Un texto sin un solo dígito NO es cero: es `null`, porque un cero es una respuesta y
 * la ausencia de número no lo es.
 */

/** Solo dígitos, separados en grupos de tres por puntos, sin coma. */
const MILES_CON_PUNTO = /^\d{1,3}(\.\d{3})+$/

/**
 * Adornos que se descartan antes de juzgar: símbolo de moneda, apóstrofo de miles y
 * los espacios que deja copiar y pegar (no separable, de cifra, estrecho no separable).
 *
 * ⚠️ Los invisibles se declaran por su CÓDIGO, no como carácter literal. Un carácter
 * invisible dentro del archivo no se puede revisar en un PR ni verificar en tránsito, y
 * los escapes escritos a mano en este repo ya se han normalizado a literales al pasar por
 * una herramienta. `String.fromCharCode` es ASCII inequívoco en la fuente, igual que el
 * `chr(n)` que este repo ya exige en las migraciones.
 */
const INVISIBLES = [0x00a0, 0x2007, 0x202f].map((c) => String.fromCharCode(c)).join('')
const ADORNOS = new RegExp(`[\\s${INVISIBLES}$']`, 'g')

/**
 * Número que declara una cadena escrita a la colombiana, o `null` si no hay número.
 *
 * Acepta también los tipos que ya vienen resueltos (`number`), para que el llamador no
 * tenga que saber por dónde entró el valor.
 */
export function parsearNumeroColombiano(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null

  const limpio = raw.replace(ADORNOS, '')
  if (limpio === '') return null
  if (!/\d/.test(limpio)) return null

  const signo = limpio.startsWith('-') ? -1 : 1
  const cuerpo = limpio.replace(/^[+-]/, '')
  if (!/^[\d.,]+$/.test(cuerpo)) return null

  let canonico: string
  if (cuerpo.includes(',')) {
    // Coma presente → decimal colombiano. Los puntos que la acompañan son miles.
    const partes = cuerpo.split(',')
    if (partes.length > 2) return null
    canonico = `${partes[0].replace(/\./g, '')}.${partes[1]}`
  } else if (MILES_CON_PUNTO.test(cuerpo)) {
    canonico = cuerpo.replace(/\./g, '')
  } else {
    canonico = cuerpo
  }

  const n = Number(canonico)
  if (!Number.isFinite(n)) return null
  return signo * n
}

/**
 * El número tal como se escribe en Colombia: punto de miles y coma decimal.
 *
 * Sirve para devolverle al operador, mientras escribe, la cifra que el sistema entendió.
 * Sin ese eco, escribir `769.898` y que se guarde `769898` es indistinguible de escribir
 * `769.898` y que se guarde `769,898`, que es exactamente la confusión que costó el caso.
 */
export function formatearNumeroColombiano(n: number): string {
  if (!Number.isFinite(n)) return ''
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6 }).format(n)
}
