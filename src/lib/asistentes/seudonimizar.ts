/**
 * Lo que sale hacia el juez y hacia el correo, sin teléfonos ni nombres de clientes finales (spec 2026-10-26, §4.3 y
 * §4.4).
 *
 * - Teléfonos (y cualquier tira de 7 o más dígitos: cédulas, NIT, cuentas): `[número]`. Un monto escrito sin puntos de
 *   7 dígitos o más también cae; se prefiere perder ese monto a dejar pasar un teléfono.
 * - Correos: `[correo]`.
 * - Nombres de clientes finales: `Persona 1`, `Persona 2`… (un número por persona). Se reconocen por dos vías, sin
 *   listas de nombres: (1) los que traen las trazas en campos de persona (`cliente`, `contacto`, `titular`…, los datos
 *   de las herramientas y de las propuestas) y (2) los que la persona dice de sí misma («soy…», «me llamo…», «mi nombre
 *   es…»). De un nombre de persona se tapa el completo y cada palabra suya de 3 letras o más, para que «Mariana» sola
 *   también caiga. Un nombre genérico (`nombre` a secas, que puede ser una experiencia) se tapa solo completo.
 *
 * No es infalible: un nombre que nadie presentó y que ninguna herramienta devolvió («dile a Pedro») pasa. Por eso el
 * texto con conversación solo sale hacia el juez en los workspaces que lo autorizaron por contrato.
 */
import type { TrazaLeida } from './conversaciones'

const CLAVES_PERSONA = new Set([
  'cliente', 'nombre_cliente', 'cliente_nombre', 'contacto', 'nombre_contacto', 'contacto_nombre', 'titular',
  'nombre_titular', 'full_name', 'nombre_completo', 'nombres', 'apellidos', 'apellido', 'pasajero', 'remitente',
  'nombre_remitente', 'comprador', 'asistente_nombre', 'persona', 'responsable_cliente', 'pagador',
])
const CLAVES_GENERICAS = new Set(['nombre', 'name', 'razon_social', 'empresa', 'nombre_empresa'])

const PALABRA_NOMBRE = "[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü'-]+"
const PRESENTACION = new RegExp(
  `\\b(?:soy|me llamo|mi nombre es|habla|le escribe|te escribe)\\s+(${PALABRA_NOMBRE}(?:\\s+(?:de\\s+(?:la\\s+|los\\s+)?)?${PALABRA_NOMBRE}){0,3})`,
  'gi',
)

// No se tapan aunque vengan en mayúscula tras «soy…» (soy Cliente, soy Yo…).
const NO_NOMBRES = new Set(['cliente', 'yo', 'el', 'la', 'una', 'uno', 'quien', 'nuevo', 'nueva', 'parte', 'persona'])

export interface Nombres {
  /** Nombres de persona: se tapan completos y por palabra. */
  personas: Set<string>
  /** Nombres genéricos: solo completos. */
  completos: Set<string>
}

export function nombresVacios(): Nombres {
  return { personas: new Set(), completos: new Set() }
}

function pareceNombre(s: string): boolean {
  const t = s.trim()
  return t.length >= 3 && t.length <= 80 && /\p{L}/u.test(t) && !/^\d/.test(t)
}

/** Recorre un valor de traza y junta los nombres de los campos de persona. */
export function nombresDeValor(v: unknown, n: Nombres, profundidad = 0): void {
  if (profundidad > 8 || v == null) return
  if (Array.isArray(v)) {
    for (const x of v) nombresDeValor(x, n, profundidad + 1)
    return
  }
  if (typeof v !== 'object') return
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const clave = k.toLowerCase()
    if (typeof x === 'string' && pareceNombre(x)) {
      if (CLAVES_PERSONA.has(clave)) n.personas.add(x.trim())
      else if (CLAVES_GENERICAS.has(clave)) n.completos.add(x.trim())
    } else if (typeof x === 'object') {
      nombresDeValor(x, n, profundidad + 1)
    }
  }
}

/** Los nombres que trae una traza: datos y argumentos de herramientas, la propuesta y su ejecución. */
export function nombresDeTraza(t: TrazaLeida | null | undefined, n: Nombres): void {
  if (!t) return
  for (const h of Array.isArray(t.herramientas) ? t.herramientas : []) {
    nombresDeValor(h?.args, n)
    nombresDeValor(h?.datos, n)
    nombresDeValor(h?.privado, n)
  }
  nombresDeValor(t.propuesta?.datos, n)
  nombresDeValor(t.propuesta?.args_modelo, n)
  nombresDeValor(t.ejecucion?.escrituras, n)
  nombresDeValor(t.persona, n)
}

/** Los nombres que alguien dice de sí mismo en un texto. */
export function nombresDeTexto(texto: string | null | undefined, n: Nombres): void {
  if (!texto) return
  for (const m of texto.matchAll(PRESENTACION)) {
    const nombre = m[1].trim()
    const palabras = nombre.split(/\s+/).filter((p) => !/^(de|la|los)$/i.test(p))
    if (!palabras.length || NO_NOMBRES.has(palabras[0].toLowerCase())) continue
    n.personas.add(nombre)
  }
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Sin acentos y en minúscula, para que «María» y «maria» sean la misma persona. */
function plano(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Patrón que encuentra la palabra con o sin acentos (María / Maria / MARÍA). */
function patronFlexible(s: string): string {
  const variantes: Record<string, string> = { a: '[aáàä]', e: '[eéèë]', i: '[iíìï]', o: '[oóòö]', u: '[uúùü]', n: '[nñ]' }
  return [...plano(s)].map((c) => variantes[c] ?? escapar(c)).join('')
}

const NUMERO = /\+?\d(?:[\s().-]*\d){6,}/g
const CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

/**
 * Tapa teléfonos, correos y nombres. Los nombres se reemplazan por `Persona N` con un número estable por persona
 * (el mismo para el nombre completo y sus palabras). `etiqueta` tapa sin numerar (`[cliente]`, en el correo) y
 * `soloNombres` deja los números (el correo lleva ids de turno, que tienen tiras de dígitos).
 * Pura.
 */
export function seudonimizar(texto: string, n: Nombres, o: { etiqueta?: string; soloNombres?: boolean } = {}): string {
  const etiqueta = o.etiqueta
  // Primero los nombres (más largos primero, para que «Mariana Restrepo» gane sobre «Mariana»).
  const alias = new Map<string, string>()
  let siguiente = 1
  const reemplazos: Array<{ patron: string; alias: string }> = []
  const personas = [...n.personas].sort((a, b) => b.length - a.length)
  for (const p of personas) {
    const k = plano(p)
    let a = alias.get(k)
    if (!a) {
      a = etiqueta ?? `Persona ${siguiente++}`
      alias.set(k, a)
    }
    reemplazos.push({ patron: patronFlexible(p).replace(/\s+/g, '\\s+'), alias: a })
    for (const palabra of p.split(/\s+/)) {
      if (palabra.length < 3 || /^(del?|la|los|las|y)$/i.test(palabra)) continue
      const kp = plano(palabra)
      if (!alias.has(kp)) alias.set(kp, a)
      reemplazos.push({ patron: patronFlexible(palabra), alias: alias.get(kp)! })
    }
  }
  for (const c of [...n.completos].sort((a, b) => b.length - a.length)) {
    if (n.personas.has(c)) continue
    reemplazos.push({ patron: patronFlexible(c).replace(/\s+/g, '\\s+'), alias: etiqueta ?? `[nombre]` })
  }
  reemplazos.sort((a, b) => b.patron.length - a.patron.length)
  let salida = texto
  for (const r of reemplazos) {
    salida = salida.replace(new RegExp(`(?<![\\p{L}\\d])${r.patron}(?![\\p{L}\\d])`, 'giu'), r.alias)
  }
  return o.soloNombres ? salida : salida.replace(CORREO, '[correo]').replace(NUMERO, '[número]')
}

/** ¿Quedó algún teléfono (7+ dígitos seguidos o separados) en el texto? Para las pruebas y como última guarda. */
export function tieneNumeroLargo(texto: string): boolean {
  return new RegExp(NUMERO.source).test(texto)
}
