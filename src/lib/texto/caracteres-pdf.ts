/**
 * Letras que la IA mete al leer un documento y que un PDF con fuente estándar no puede escribir.
 *
 * Medido el 2026-10-06 (soena): la lectura con IA devolvió letras CIRÍLICAS idénticas a las
 * latinas en datos del RUT. V0121: «CIR 2 66 В 151» con В (U+0412) en vez de B. El 010 se caía
 * con «WinAnsi cannot encode "В" (0x0412)», porque Helvetica (WinAnsi) no tiene esa letra y
 * pdf-lib lanza. Peor: en V0167 y V0143 la IA escribió «МЕЛА» y «САЛСА» (MEJIA, CAJICA): la Л no
 * se parece a nada latino, el nombre quedó MAL escrito, no solo mal codificado.
 *
 * Dos reglas:
 * - Un DOBLE EXACTO (la misma figura en otro alfabeto: А В Е К М Н О Р С Т Х, griego Α Β Ε…) se
 *   convierte a su letra latina. No cambia lo que dice el documento.
 * - Cualquier otra letra que WinAnsi no tenga NO se adivina: se informa para que una persona la
 *   corrija. «Л» puede ser «JI», «L» o cualquier cosa.
 *
 * Puro: lo usan la extracción (marca el campo para revisar) y el estampado de PDF.
 */

// Cirílico y griego que se ven igual que una letra latina (mayúscula y minúscula).
const DOBLES: Record<string, string> = {
  // Cirílico mayúsculas
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C',
  'Т': 'T', 'Х': 'X', 'У': 'Y', 'І': 'I', 'Ј': 'J', 'Ѕ': 'S',
  // Cirílico minúsculas
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  // Griego mayúsculas
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N',
  'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  // Griego minúsculas
  'ο': 'o',
}

// Puntuación tipográfica que WinAnsi sí trae pero conviene llevar a ASCII, y espacios raros.
const NORMALIZAR: Array<[RegExp, string]> = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/…/g, '...'],
  [/[    - ]/g, ' '],
  [/[​-‍﻿]/g, ''],
  [/\t/g, ' '],
]

// Los 27 caracteres de Windows-1252 (0x80-0x9F) que WinAnsi agrega a Latin-1.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

/** ¿Lo puede escribir Helvetica / Times / Courier estándar (WinAnsi)? */
export function esWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  if (c === 0x0a) return true // pdf-lib parte las líneas antes de codificar
  if (c >= 0x20 && c <= 0x7e) return true
  if (c >= 0xa0 && c <= 0xff) return true
  return CP1252_EXTRA.has(ch)
}

/** Convierte los dobles exactos y normaliza puntuación. No toca nada más. */
export function aLetraLatina(v: string): string {
  let s = v.normalize('NFC')
  for (const [re, r] of NORMALIZAR) s = s.replace(re, r)
  return Array.from(s, (ch) => DOBLES[ch] ?? ch).join('')
}

/** Lo que sigue sin poderse escribir después de convertir, sin repetir. */
export function caracteresNoImprimibles(v: string): string[] {
  return [...new Set(Array.from(aLetraLatina(v)).filter((ch) => !esWinAnsi(ch)))]
}

/** ¿El texto trae letras de otro alfabeto (aunque sean dobles exactos)? Para marcar en la extracción. */
export function tieneLetrasNoLatinas(v: string): boolean {
  return /[Ͱ-ϿЀ-ӿԀ-ԯ]/.test(v)
}

export class CaracterNoImprimibleError extends Error {
  constructor(
    readonly caracteres: string[],
    readonly valor: string,
    readonly campo: string | null = null,
  ) {
    super(mensajeCaracterNoValido(campo, caracteres, valor))
    this.name = 'CaracterNoImprimibleError'
  }
}

export function mensajeCaracterNoValido(campo: string | null, caracteres: string[], valor: string): string {
  const cuales = caracteres.map((c) => `"${c}"`).join(', ')
  const plural = caracteres.length > 1 ? 'unos caracteres no válidos' : 'un carácter no válido'
  const donde = campo ? `El campo «${campo}»` : `El dato «${valor.slice(0, 60)}»`
  return `${donde} tiene ${plural}: ${cuales}. Corrígelo y vuelve a generar.`
}

/**
 * Deja listo un texto para estampar con fuente estándar: dobles convertidos. Si queda algo que
 * no se puede escribir, lanza `CaracterNoImprimibleError` con un mensaje para la persona (nunca
 * el «WinAnsi cannot encode» de pdf-lib).
 */
export function textoParaPdf(v: string, campo: string | null = null): string {
  const s = aLetraLatina(v)
  const malos = [...new Set(Array.from(s).filter((ch) => !esWinAnsi(ch)))]
  if (malos.length > 0) throw new CaracterNoImprimibleError(malos, v, campo)
  return s
}

/**
 * Prepara todos los datos de un formulario de una vez, con el nombre del campo en el mensaje.
 * Devuelve los datos convertidos, o el primer campo que no se puede imprimir.
 */
export function datosParaPdf<T extends Record<string, unknown>>(
  datos: T,
  etiqueta: (campo: string) => string = (c) => c.replace(/_/g, ' '),
): { ok: true; datos: T } | { ok: false; campo: string; caracteres: string[]; mensaje: string } {
  const out: Record<string, unknown> = { ...datos }
  for (const [k, v] of Object.entries(datos)) {
    if (typeof v !== 'string') continue
    const s = aLetraLatina(v)
    const malos = caracteresNoImprimibles(s)
    if (malos.length > 0) {
      return { ok: false, campo: k, caracteres: malos, mensaje: mensajeCaracterNoValido(etiqueta(k), malos, v) }
    }
    out[k] = s
  }
  return { ok: true, datos: out as T }
}

/**
 * Lo que la extracción hace con un valor leído: convierte los dobles exactos y devuelve las
 * letras que no se pudieron convertir (cualquier letra no latina, aunque WinAnsi la tuviera).
 * Con `noValidas` no vacío el campo va a revisión.
 */
export function revisarLetrasLeidas(v: string): { valor: string; noValidas: string[] } {
  const valor = aLetraLatina(v)
  const noValidas = [...new Set(Array.from(valor).filter((ch) => !esWinAnsi(ch) || tieneLetrasNoLatinas(ch)))]
  return { valor, noValidas }
}
