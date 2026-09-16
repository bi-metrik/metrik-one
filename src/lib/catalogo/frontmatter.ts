/**
 * Lectura del frontmatter de un archivo de catálogo de servicios.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §3.2 (entrega A2).
 *
 * ## Por qué no es un parser de YAML
 *
 * El archivo fuente vive en el cerebro (`cerebro/catalogo/servicios/<slug>.md`) y lo escribe
 * una persona. De ahí sale el precio de lista de un servicio y los parámetros con los que se
 * cobra: **un valor mal leído aquí es un cobro equivocado**, y un parser permisivo lo lee mal
 * en silencio. Por eso esto NO intenta ser YAML: es la gramática cerrada que el catálogo usa,
 * y **todo lo que no está en la gramática se rechaza con la línea**, en vez de adivinar.
 *
 * Lo que entiende, y nada más:
 *
 * ```yaml
 * ---
 * clave: valor                      # escalar: texto, entero, decimal, true/false
 * lista_plana: [a, b, 80, 95]       # secuencia en línea
 * mapa:                             # mapa anidado, UN nivel
 *   sub_clave: { a: 1, b: [2, 3] }  # mapa en línea, con listas adentro
 *   otra: valor
 * ---
 * ```
 *
 * Lo que rechaza a propósito: bloques con `-` al margen, anidamiento de más de un nivel,
 * cadenas multilínea (`|`, `>`), anclas (`&`, `*`), llaves repetidas y cualquier línea que no
 * calce. Si el catálogo llega a necesitar algo de eso, se amplía aquí **con su prueba**, no se
 * afloja el parser.
 *
 * Los comentarios `#` se descartan salvo dentro de comillas.
 *
 * Módulo puro: lo usan el receptor de `/api/catalogo/versiones` y sus pruebas. Sin red, sin
 * base, sin `node:fs`.
 */

export type ValorFrontmatter =
  | string
  | number
  | boolean
  | ValorFrontmatter[]
  | { [clave: string]: ValorFrontmatter }

export interface Frontmatter {
  [clave: string]: ValorFrontmatter
}

export class ErrorFrontmatter extends Error {
  constructor(
    mensaje: string,
    /** Línea del archivo completo (1-based), para que el mensaje sirva sin adivinar. */
    readonly linea?: number,
  ) {
    super(linea === undefined ? mensaje : `línea ${linea}: ${mensaje}`)
    this.name = 'ErrorFrontmatter'
  }
}

const DELIMITADOR = /^---\s*$/

/**
 * Separa el bloque de frontmatter del cuerpo. El archivo TIENE que empezar por `---`: un
 * archivo sin frontmatter no es un archivo de catálogo, y tratarlo como uno vacío haría que
 * el receptor rechazara por "faltan campos" en vez de por lo que pasa de verdad.
 */
export function separarFrontmatter(texto: string): { crudo: string; primeraLinea: number } {
  // Un BOM al principio (Windows, algunos editores) haría fallar el `---` sin decir por qué.
  const limpio = texto.replace(/^﻿/, '')
  const lineas = limpio.split('\n')
  if (lineas.length === 0 || !DELIMITADOR.test(lineas[0])) {
    throw new ErrorFrontmatter('el archivo no empieza con el delimitador ---', 1)
  }
  const cierre = lineas.findIndex((l, i) => i > 0 && DELIMITADOR.test(l))
  if (cierre === -1) throw new ErrorFrontmatter('el frontmatter no se cierra con ---')
  return { crudo: lineas.slice(1, cierre).join('\n'), primeraLinea: 2 }
}

/** Quita el comentario `#` de una línea, respetando lo que esté entre comillas. */
function sinComentario(linea: string): string {
  let comilla: string | null = null
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (comilla) {
      if (c === comilla) comilla = null
    } else if (c === '"' || c === "'") {
      comilla = c
    } else if (c === '#' && (i === 0 || /\s/.test(linea[i - 1]))) {
      return linea.slice(0, i)
    }
  }
  return linea
}

/**
 * Convierte un escalar. El orden importa: primero comillas (una cadena entrecomillada se
 * respeta tal cual, aunque parezca número), después booleano, después número, y al final
 * texto. Un `01` o un `1_000` NO se leen como número: se quedan como texto, porque
 * convertirlos sería inventar una interpretación.
 */
function leerEscalar(bruto: string, linea: number): ValorFrontmatter {
  const t = bruto.trim()
  if (t === '') throw new ErrorFrontmatter('valor vacío', linea)

  if ((t.startsWith('"') && t.endsWith('"') && t.length > 1) ||
      (t.startsWith("'") && t.endsWith("'") && t.length > 1)) {
    return t.slice(1, -1)
  }
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null' || t === '~') {
    throw new ErrorFrontmatter('`null` no se escribe: omití la clave', linea)
  }
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) return Number(t)
  if (/^[&*|>]/.test(t)) {
    throw new ErrorFrontmatter(`el frontmatter del catálogo no admite "${t[0]}"`, linea)
  }
  return t
}

/** Parte por comas respetando `[...]`, `{...}` y comillas. */
function partirEnComas(cuerpo: string, linea: number): string[] {
  const partes: string[] = []
  let nivel = 0
  let comilla: string | null = null
  let desde = 0
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i]
    if (comilla) {
      if (c === comilla) comilla = null
      continue
    }
    if (c === '"' || c === "'") comilla = c
    else if (c === '[' || c === '{') nivel++
    else if (c === ']' || c === '}') nivel--
    else if (c === ',' && nivel === 0) {
      partes.push(cuerpo.slice(desde, i))
      desde = i + 1
    }
  }
  if (nivel !== 0) throw new ErrorFrontmatter('corchete o llave sin cerrar', linea)
  if (comilla) throw new ErrorFrontmatter('comilla sin cerrar', linea)
  const ultima = cuerpo.slice(desde)
  if (ultima.trim() !== '' || partes.length === 0) partes.push(ultima)
  return partes
}

function leerValor(bruto: string, linea: number): ValorFrontmatter {
  const t = bruto.trim()

  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new ErrorFrontmatter('lista sin cerrar con ]', linea)
    const dentro = t.slice(1, -1).trim()
    if (dentro === '') return []
    return partirEnComas(dentro, linea).map((p) => leerValor(p, linea))
  }

  if (t.startsWith('{')) {
    if (!t.endsWith('}')) throw new ErrorFrontmatter('mapa sin cerrar con }', linea)
    const dentro = t.slice(1, -1).trim()
    const salida: Record<string, ValorFrontmatter> = {}
    if (dentro === '') return salida
    for (const par of partirEnComas(dentro, linea)) {
      const corte = par.indexOf(':')
      if (corte === -1) throw new ErrorFrontmatter(`«${par.trim()}» no es clave: valor`, linea)
      const clave = par.slice(0, corte).trim()
      if (clave === '') throw new ErrorFrontmatter('clave vacía dentro de { }', linea)
      if (clave in salida) throw new ErrorFrontmatter(`clave repetida «${clave}»`, linea)
      salida[clave] = leerValor(par.slice(corte + 1), linea)
    }
    return salida
  }

  return leerEscalar(t, linea)
}

/**
 * Lee el frontmatter de un archivo de catálogo. Devuelve el objeto o lanza `ErrorFrontmatter`
 * con la línea. Nunca devuelve un objeto a medias.
 */
export function leerFrontmatter(texto: string): Frontmatter {
  const { crudo, primeraLinea } = separarFrontmatter(texto)
  const salida: Frontmatter = {}
  const lineas = crudo.split('\n')

  let mapaAbierto: { clave: string; sangria: number } | null = null
  /** Claves que se abrieron como bloque sangrado, con la línea donde se abrieron. */
  const bloques = new Map<string, number>()

  for (let i = 0; i < lineas.length; i++) {
    const nLinea = primeraLinea + i
    const cruda = sinComentario(lineas[i])
    if (cruda.trim() === '') continue

    if (/^\s*-/.test(cruda)) {
      throw new ErrorFrontmatter(
        'las listas del catálogo se escriben en línea ([a, b]), no con guiones',
        nLinea,
      )
    }
    if (/\t/.test(cruda)) throw new ErrorFrontmatter('sangría con tabulador', nLinea)

    const sangria = cruda.length - cruda.trimStart().length
    const contenido = cruda.trim()
    const corte = contenido.indexOf(':')
    if (corte === -1) throw new ErrorFrontmatter(`«${contenido}» no es clave: valor`, nLinea)

    const clave = contenido.slice(0, corte).trim()
    const resto = contenido.slice(corte + 1).trim()
    if (clave === '') throw new ErrorFrontmatter('clave vacía', nLinea)

    if (sangria === 0) {
      mapaAbierto = null
      if (clave in salida) throw new ErrorFrontmatter(`clave repetida «${clave}»`, nLinea)
      if (resto === '') {
        salida[clave] = {}
        mapaAbierto = { clave, sangria: -1 }
        bloques.set(clave, nLinea)
      } else {
        salida[clave] = leerValor(resto, nLinea)
      }
      continue
    }

    if (!mapaAbierto) {
      throw new ErrorFrontmatter('sangría sin una clave que la abra', nLinea)
    }
    if (mapaAbierto.sangria === -1) mapaAbierto.sangria = sangria
    if (sangria !== mapaAbierto.sangria) {
      throw new ErrorFrontmatter(
        `sangría de ${sangria}; el catálogo solo anida un nivel y este bloque va a ${mapaAbierto.sangria}`,
        nLinea,
      )
    }
    if (resto === '') {
      throw new ErrorFrontmatter('el catálogo solo anida un nivel: este mapa va en línea { }', nLinea)
    }

    const contenedor = salida[mapaAbierto.clave] as Record<string, ValorFrontmatter>
    if (clave in contenedor) throw new ErrorFrontmatter(`clave repetida «${clave}»`, nLinea)
    contenedor[clave] = leerValor(resto, nLinea)
  }

  // Un bloque sangrado que quedó sin hijos es un bloque a medias (se borró su contenido, o
  // la sangría no calzó y se perdió). Si de verdad va vacío se escribe `clave: {}` en línea,
  // que sí pasa: ahí la intención está escrita.
  for (const [clave, linea] of bloques) {
    const v = salida[clave] as Record<string, ValorFrontmatter>
    if (Object.keys(v).length === 0) {
      throw new ErrorFrontmatter(`«${clave}» quedó sin contenido; si va vacío, escribí ${clave}: {}`, linea)
    }
  }

  return salida
}
