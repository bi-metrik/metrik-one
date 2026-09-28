/**
 * El puntaje (FIT) del Radar SECOP. **Autoridad única.**
 *
 * Spec: `proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md`, bloque D.
 *
 * ## Por qué este archivo existe
 *
 * Hasta el 2026-09-28 el mismo algoritmo vivía DOS veces: `scripts/temas.py` (el correo semanal y
 * el exportador) y una función `puntuar()` en JS dentro de `dashboard/index.html` (el tablero). El
 * propio `temas.py` lo dice en su cabecera: «Cualquier cambio de regla se hace en los dos lados».
 * Eso es una promesa, no una garantía: si se separan, el correo dice un número y el tablero otro.
 * Aquí hay una sola implementación y las pruebas de caso fijan los números.
 *
 * ## Las cuatro reglas, y qué pasa si se tocan
 *
 * 1. **Un tema suma UNA sola vez** aunque el objeto repita sus sinónimos. Es una expresión por
 *    tema (alternativa de sus términos), no una por término: «SISTEMA DE INFORMACION y evolutivos
 *    del SISTEMA DE INFORMACION» suma 5, no 10. Esa regla bajó toda la escala ~30 % el 2026-09-28
 *    y por eso el umbral del correo semanal bajó de 5 a 4.
 * 2. **Palabras completas, con plural tolerado de S/ES** — no substring. El substring crudo no
 *    cruzaba `SISTEMA DE INFORMACION` con `SISTEMAS DE INFORMACION`, y `OPERACION` sí cruzaba con
 *    `COOPERACION`: por eso el monitor perdió `SDP-LP-003-2026` ($5.528M) durante meses. El plural
 *    tolerado es S/ES, **no el género**: `FERREO` no cruzaba con `FERREA`, así que la biblioteca
 *    lista las dos formas.
 * 3. **El castigo por forma de compra SÍ se topa; el de dominio ajeno NO.** Un tema positivo de
 *    peso >= `senal_fuerte` topa el castigo de grupo `compra` en la mitad del bruto, porque un
 *    contrato de desarrollo real casi siempre dice también «mantenimiento». El castigo por dominio
 *    ajeno no se topa: que el objeto sea producción audiovisual o vía férrea no lo arregla ninguna
 *    señal técnica (los dos falsos positivos del 2026-09-07).
 * 4. **Las exclusiones son del PERFIL, no del sistema.** Lo que para MeTRIK es ruido (OBRA, ASEO,
 *    VIAL) para una constructora o una empresa de aseo es exactamente su negocio. Una lista global
 *    de exclusiones es el sesgo de un sector disfrazado de regla.
 *
 * ## Una diferencia deliberada con el JS del tablero, medida antes de escribirla
 *
 * El tablero aplanaba `stems` y `palabras` de las exclusiones en una sola lista y las probaba
 * todas como substring. Medido el 2026-09-28 sobre los 1.908 procesos abiertos del día con el
 * perfil `fabri`: eso excluye **4 procesos de más**, todos porque `VIDEOVIGILANCIA` contiene
 * `VIGILANCIA` (LP-009-2026, 4161.010.32.1.1705.2026, MRAM-MC-062-2026, SASI-018-2026). Aquí se
 * conserva la distinción de `temas.py`: un `stem` es substring (es un fragmento a propósito, como
 * `VACUN`) y una `palabra` es palabra completa. Es la misma lección de la regla 2, aplicada al
 * otro lado del filtro.
 *
 * Puro: sin `node:*`, sin Supabase y sin `server-only`. Lo importan el cron de sincronización, la
 * pantalla (cliente) y sus pruebas, y los tres tienen que dar el MISMO número.
 */

/** Un tema: un concepto con sus sinónimos y un peso. */
export interface Tema {
  id: string
  /** Grupo del catálogo (`tic`, `mobiliario`, …). `compra` es el único cuyo castigo se topa. */
  grupo: string
  nombre: string
  peso: number
  terminos: readonly string[]
}

/** Las exclusiones de un perfil. Vacío = no excluye nada. */
export interface Exclusiones {
  /** Fragmentos, a propósito: `VACUN` cubre vacunación y vacunas. Se prueban como substring. */
  stems?: readonly string[]
  /** Palabras completas, con el mismo plural tolerado del puntaje. */
  palabras?: readonly string[]
}

/** Un tema que cruzó, con el peso que se aplicó (el del perfil, si lo ajustó). */
export interface TemaAcertado {
  id: string
  nombre: string
  grupo: string
  peso: number
}

export interface Puntaje {
  fit: number
  hits: TemaAcertado[]
  /** Al menos un tema de peso positivo apareció. «Coincide» no es lo mismo que «fit alto». */
  pos: boolean
}

/**
 * Mayúsculas sin tildes. `String.normalize('NFD')` + quitar los diacríticos combinantes
 * (rango Unicode U+0300–U+036F), que es lo que hace `unicodedata.category(c) != 'Mn'` en Python.
 */
export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
}

const ESCAPAR = /[.*+?^${}()|[\]\\]/g

/** Un término como palabras completas, tolerando plural S/ES. `\W+` entre palabras. */
function fuenteTermino(termino: string): string {
  return norm(termino)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w.replace(ESCAPAR, '\\$&')}(?:ES|S)?`)
    .join('\\W+')
}

const cacheTermino = new Map<string, RegExp>()

/** ¿El texto (ya normalizado) menciona este término como palabras completas? */
export function tiene(textoNormalizado: string, termino: string): boolean {
  let rx = cacheTermino.get(termino)
  if (!rx) {
    rx = new RegExp(`\\b${fuenteTermino(termino)}\\b`)
    cacheTermino.set(termino, rx)
  }
  return rx.test(textoNormalizado)
}

const cacheTema = new Map<string, RegExp>()

/**
 * UNA expresión por tema: la alternativa de todos sus términos. Es lo que hace que un tema sume
 * una sola vez (regla 1) y también lo que permite contar 97 temas contra 1.908 objetos sin que se
 * sienta: 427 pruebas por objeto se vuelven 97.
 */
export function expresionDeTema(t: Pick<Tema, 'id' | 'terminos'>): RegExp {
  const clave = `${t.id}|${t.terminos.join('~')}`
  let rx = cacheTema.get(clave)
  if (!rx) {
    rx = new RegExp(`\\b(?:${t.terminos.map(fuenteTermino).join('|')})\\b`)
    cacheTema.set(clave, rx)
  }
  return rx
}

/** ¿Este tema aparece en el objeto? El objeto se pasa YA normalizado. */
export function temaAparece(objetoNormalizado: string, t: Pick<Tema, 'id' | 'terminos'>): boolean {
  return expresionDeTema(t).test(objetoNormalizado)
}

/**
 * FIT del objeto contra los temas activos del perfil.
 *
 * `temas` son los temas YA seleccionados y YA con el peso del perfil aplicado: esta función no
 * sabe de perfiles. Pasarle la biblioteca entera suma temas que no son de la empresa — sirve para
 * explorar, no para decidir.
 *
 * `senalFuerte` es el umbral de señal fuerte de la biblioteca (hoy 8). Se recibe, no se constantiza:
 * es un dato de la biblioteca y subirlo o bajarlo es una decisión de calibración.
 */
export function puntuar(objeto: string, temas: readonly Tema[], senalFuerte: number): Puntaje {
  const u = norm(objeto)
  let bruto = 0
  let forma = 0
  let dominio = 0
  let fuerte = false
  const hits: TemaAcertado[] = []

  for (const t of temas) {
    if (!temaAparece(u, t)) continue
    hits.push({ id: t.id, nombre: t.nombre, grupo: t.grupo, peso: t.peso })
    if (t.peso >= 0) {
      bruto += t.peso
      if (t.peso >= senalFuerte) fuerte = true
    } else if (t.grupo === 'compra') {
      forma += t.peso
    } else {
      dominio += t.peso
    }
  }

  // El tope protege SOLO al castigo por cómo compra la entidad. `Math.floor` sobre un bruto que
  // aquí siempre es >= 0 es la misma división entera que `bruto // 2` en Python.
  if (fuerte) forma = Math.max(forma, -Math.floor(bruto / 2))

  return { fit: bruto + forma + dominio, hits, pos: hits.some((h) => h.peso > 0) }
}

/**
 * ¿El objeto cae en una exclusión del perfil? Devuelve la exclusión que lo sacó (para poder
 * decirlo en pantalla) o `null`.
 *
 * Los `stems` primero y como substring; las `palabras` después y como palabras completas. Ver la
 * cabecera: aplanar las dos listas en substring excluye de más.
 */
export function excluido(objeto: string, ex: Exclusiones | null | undefined): string | null {
  if (!ex) return null
  const u = norm(objeto)
  for (const e of ex.stems ?? []) {
    if (norm(e).trim() && u.includes(norm(e).trim())) return e.toLowerCase()
  }
  for (const e of ex.palabras ?? []) {
    if (norm(e).trim() && tiene(u, e)) return e.toLowerCase()
  }
  return null
}
