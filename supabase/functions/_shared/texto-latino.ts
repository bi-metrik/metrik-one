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
 * Desde el 2026-10-06 es el BLOQUEO DE TODO ONE (Mauricio): toda entrada de texto pasa por aquí
 * (lo que lee la IA, lo que se escribe en bloques, contactos y empresas, los leads de Meta, el
 * bot de WhatsApp, las importaciones) y todo PDF que estampa con fuente estándar también. El
 * barrido de producción encontró griego además del cirílico («ΤΟ», «JOHΝ», «XΕΙ») y un contacto
 * con el nombre entero en cirílico que entró por un lead.
 *
 * ⚠️ Sin imports A PROPÓSITO: `supabase/functions/_shared/texto-latino.ts` es una copia EXACTA
 * para las edge functions (Deno no resuelve `@/lib`). La prueba `texto-latino.test.ts` falla si
 * las dos se separan.
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
 * Lo que la extracción y las entradas hacen con un valor: convierte los dobles exactos y devuelve
 * las letras de otra escritura que no se pudieron convertir.
 * Con `noValidas` no vacío el campo va a revisión.
 */
export function revisarLetrasLeidas(v: string): { valor: string; noValidas: string[] } {
  const valor = aLetraLatina(v)
  // Solo LETRAS de otra escritura (cirílico, griego, y cualquier otra que no sea latina). Un
  // símbolo (→, ≥, un emoji) no es una letra mal leída: frenar por eso trabaría casos sanos. El
  // PDF, que sí necesita WinAnsi estricto, lo revisa aparte (`datosParaPdf`).
  const noValidas = [...new Set(Array.from(valor).filter((ch) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)))]
  return { valor, noValidas }
}

// ── El bloqueo en las entradas ──────────────────────────────────────────────────────────────

/**
 * Lo mismo para cualquier valor: convierte los dobles en cada texto, dentro de objetos y listas.
 * Lo que no es texto pasa igual. Para lo que entra de afuera (un lead, un JSON de la IA, una fila
 * importada) antes de guardarlo.
 */
export function textoLatinoProfundo<T>(v: T): T {
  if (typeof v === 'string') return aLetraLatina(v) as unknown as T
  if (Array.isArray(v)) return v.map((x) => textoLatinoProfundo(x)) as unknown as T
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = textoLatinoProfundo(x)
    return out as T
  }
  return v
}

/**
 * ¿Este campo termina en un documento oficial? Nombre, identificación, dirección, municipio,
 * correo, placa o línea del vehículo (lo que Mauricio listó el 2026-10-06). Se decide por el
 * nombre del campo (slug), sin tildes y en minúsculas.
 */
export function esCampoOficial(campo: string): boolean {
  const c = campo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return /nombre|full_name|^name$|apellido|razon_social|titular|suscriptor|comprador|identificac|documento|cedula|nit\b|^nit|_nit|\bdv\b|^dv|_dv|direcci|municipio|ciudad|city|departamento|seccional|correo|email|placa|linea|vin\b|^vin|_vin|marca|modelo|chasis|motor/.test(c)
}

/**
 * El primer campo OFICIAL con algo que no se puede escribir, después de convertir los dobles.
 * `claves` acota la revisión a lo que la persona acaba de mandar (no frena un guardado por un
 * dato viejo de otro campo).
 */
export function primerCampoOficialNoValido(
  valores: Record<string, unknown>,
  etiqueta: (campo: string) => string = (c) => c.replace(/_/g, ' '),
  claves: Iterable<string> = Object.keys(valores),
): { campo: string; caracteres: string[]; mensaje: string } | null {
  for (const k of claves) {
    const v = valores[k]
    if (typeof v !== 'string' || !esCampoOficial(k)) continue
    const malos = revisarLetrasLeidas(v).noValidas
    if (malos.length > 0) return { campo: k, caracteres: malos, mensaje: mensajeCaracterNoValido(etiqueta(k), malos, v) }
  }
  return null
}

/**
 * Un formulario (FormData) con los dobles convertidos. Si un campo oficial trae algo que no se
 * puede convertir, devuelve el mensaje para la persona y no se guarda nada.
 */
export function formularioLatino(
  fd: FormData,
  etiqueta?: (campo: string) => string,
): { ok: true; formData: FormData } | { ok: false; mensaje: string } {
  const out = new FormData()
  const valores: Record<string, unknown> = {}
  fd.forEach((v, k) => {
    const x = typeof v === 'string' ? aLetraLatina(v) : v
    out.append(k, x)
    if (typeof x === 'string') valores[k] = x
  })
  const malo = primerCampoOficialNoValido(valores, etiqueta)
  if (malo) return { ok: false, mensaje: malo.mensaje }
  return { ok: true, formData: out }
}

/**
 * Los campos oficiales de un negocio que NO se pueden escribir en un documento: los que la
 * extracción marcó (`letras_no_validas`) y los que, ya guardados, traen una letra imposible.
 * Lee la forma de los dos tipos de bloque: `datos` (valor en la raíz de `data`) y documento
 * (`data.campos[slug].value`). Es lo que frena el avance de etapa.
 */
export function camposOficialesNoValidos(
  filas: ReadonlyArray<{ bloque: string | null; data: unknown }>,
): Array<{ bloque: string | null; campo: string; caracteres: string[] }> {
  const out: Array<{ bloque: string | null; campo: string; caracteres: string[] }> = []
  for (const f of filas) {
    const data = f.data && typeof f.data === 'object' ? (f.data as Record<string, unknown>) : null
    if (!data) continue
    for (const [k, v] of Object.entries(data)) {
      if (typeof v !== 'string' || !esCampoOficial(k)) continue
      const malos = revisarLetrasLeidas(v).noValidas
      if (malos.length > 0) out.push({ bloque: f.bloque, campo: k, caracteres: malos })
    }
    const campos = data.campos && typeof data.campos === 'object' ? (data.campos as Record<string, unknown>) : null
    for (const [k, c] of Object.entries(campos ?? {})) {
      const r = c && typeof c === 'object' ? (c as { value?: unknown; letras_no_validas?: unknown }) : null
      if (!r) continue
      const valor = typeof r.value === 'string' ? r.value : ''
      const malos = valor && esCampoOficial(k) ? revisarLetrasLeidas(valor).noValidas : []
      // La marca de la extracción vale mientras el valor siga trayendo letras no latinas.
      if (malos.length > 0) out.push({ bloque: f.bloque, campo: k, caracteres: malos })
    }
  }
  return out
}
