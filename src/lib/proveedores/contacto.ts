/**
 * Los datos de contacto de un proveedor, como llegan (de Airtable o escritos a mano). PURO.
 *
 * El celular se guarda dos veces: el original, tal cual, y en E.164 (`+573001234567`) cuando se
 * puede saber cuál es. Un número que no se entiende NO se adivina: queda solo el original.
 */

/** País (ISO 3166-1 alfa-2) → indicativo, para los números locales que llegan sin él. */
const INDICATIVO: Record<string, string> = {
  CO: '57', PA: '507', MX: '52', DO: '1', US: '1', ES: '34', PE: '51', EC: '593', CR: '506',
  AR: '54', CL: '56', BR: '55', CU: '53', AW: '297', CW: '599', IT: '39', FR: '33', PT: '351',
}

/** Largo del número nacional (sin indicativo) cuando se conoce con certeza. */
const LARGO_NACIONAL: Record<string, number> = { CO: 10, PA: 8, MX: 10, DO: 10, US: 10, ES: 9, PE: 9, CR: 8 }

export interface Celular {
  /** `+573001234567` o `null` si no se pudo saber. */
  e164: string | null
  /** Lo que llegó, recortado. `null` si llegó vacío. */
  original: string | null
}

/**
 * El celular en E.164. Reglas:
 *  · con `+` o `00` adelante: se respeta el indicativo (7 a 15 dígitos en total);
 *  · Colombia: 10 dígitos que empiezan en 3, o 57 + esos 10;
 *  · otro país conocido: el largo nacional exacto recibe su indicativo;
 *  · lo demás (varios números pegados, letras, un fijo de 7 dígitos): sin E.164.
 * El `.0` que deja Excel se corta ANTES de limpiar (igual que `contactos/telefono.ts`).
 */
export function normalizarCelular(raw: string | null | undefined, pais: string | null = 'CO'): Celular {
  const original = (raw ?? '').trim() || null
  if (!original) return { e164: null, original: null }
  // Dos números en la misma celda («300 123 4567 / 301 765 4321»): el primero, si se entiende.
  const primero = original.split(/\s*(?:\/|;|,|\by\b|\bo\b)\s*/)[0]
  const sinDecimal = primero.trim().replace(/[.,]0+$/, '')
  if (/[a-z]{3,}/i.test(sinDecimal)) return { e164: null, original }
  const conMas = /^\s*(\+|00)/.test(sinDecimal)
  let d = sinDecimal.replace(/\D/g, '')
  if (conMas && sinDecimal.trim().startsWith('00')) d = d.slice(2)
  if (!d) return { e164: null, original }
  if (conMas) return { e164: d.length >= 8 && d.length <= 15 && d[0] !== '0' ? `+${d}` : null, original }
  while (d.length > 12 && d.startsWith('5757')) d = d.slice(2)
  if (d.length === 12 && d.startsWith('573')) return { e164: `+${d}`, original }
  if (d.length === 10 && d.startsWith('3') && (!pais || pais === 'CO')) return { e164: `+57${d}`, original }
  const p = (pais ?? '').toUpperCase()
  const ind = INDICATIVO[p]
  const largo = LARGO_NACIONAL[p]
  if (ind && largo && d.length === largo) return { e164: `+${ind}${d}`, original }
  if (ind && largo && d.length === ind.length + largo && d.startsWith(ind)) return { e164: `+${d}`, original }
  return { e164: null, original }
}

const CORREO = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

/** El primer correo válido de un texto («Reservas: ventas@hotel.com / gerencia@hotel.com») y los demás. */
export function correosDeTexto(raw: string | null | undefined): { correo: string | null; otros: string[] } {
  const todos = [...new Set(((raw ?? '').match(CORREO) ?? []).map((c) => c.toLowerCase().replace(/\.+$/, '')))]
  return { correo: todos[0] ?? null, otros: todos.slice(1) }
}

/** La web con su esquema, o `null` si no parece una dirección. */
export function normalizarWeb(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  if (!t || /\s/.test(t) || !/\.[a-z]{2,}/i.test(t)) return null
  const con = /^https?:\/\//i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(con)
    return u.protocol === 'https:' || u.protocol === 'http:' ? con.slice(0, 500) : null
  } catch {
    return null
  }
}
