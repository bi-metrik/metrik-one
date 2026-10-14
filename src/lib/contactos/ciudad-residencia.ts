/**
 * La ciudad de residencia que el lead DECLARA en el formulario de Meta, normalizada
 * para poder contarla.
 *
 * ## De dónde sale
 *
 * De `contacto_interacciones.payload.field_data`, el arreglo `{name, values}` que
 * escribe `meta-leads-webhook`. Los formularios de SOENA preguntan
 * `¿en_qué_ciudad_reside?` (926 interacciones medidas el 2026-10-14) y alguno viejo
 * usa `city` (4). El campo se reconoce por PARECIDO del nombre, con el mismo criterio
 * de `campos-formulario.ts`: una lista exacta de nombres deja de funcionar entera el
 * día que Meta renombra el formulario, y ya pasó una vez.
 *
 * ⚠️ NO es la seccional DIAN. La seccional llega con el RUT en Documentación y es la
 * que usan el tablero directivo y la tabla «Ventas por ciudad». Son dos ciudades
 * distintas de la misma persona: donde dice vivir y dónde tiene registrado el RUT.
 *
 * ## Qué se normaliza
 *
 * El texto es libre y llega como la persona lo tecleó: `Medellín`, `medellin `,
 * `MEDELLIN`, `rionegro antioquia`, `Cali, Valle`. La CLAVE de agrupación quita
 * tildes, mayúsculas, signos y espacios de más, se queda con lo que va antes de la
 * primera coma o guion, y suelta el departamento (o «Colombia», o «D.C.») que venga
 * pegado al final.
 *
 * ⚠️ El departamento solo se suelta si lo que queda NO era ya un municipio con ese
 * nombre completo. `Puerto Boyacá`, `Ciudad Bolívar` y `San José del Guaviare` son
 * municipios del DANE que terminan en nombre de departamento; recortarlos daría
 * «Puerto», «Ciudad» y «San José del». El catálogo que lo decide es el mismo DIVIPOLA
 * que resuelve las casillas del RUT (`divipola-catalogo.generated.ts`).
 *
 * ⚠️ NO se agrupan municipios en su área metropolitana: Envigado no es Medellín ni
 * Floridablanca es Bucaramanga. La persona declaró una ciudad y el tablero muestra esa;
 * fundirlas sería una decisión comercial (¿a qué sede le toca?) que nadie ha tomado.
 *
 * ⚠️ Este módulo arrastra el catálogo DIVIPOLA (~80 KB). Úsalo en el SERVIDOR; al
 * navegador debe llegar la ciudad ya normalizada, no el catálogo.
 */

import { DEPARTAMENTOS_DANE, MUNICIPIOS_POR_DEPTO } from '@/lib/dian/divipola-catalogo.generated'
import type { CampoFormulario } from './campos-formulario'

/** Quita tildes y baja a minúsculas. La ñ queda en n. */
function sinTildes(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Palabras de un nombre de campo: `¿en_qué_ciudad_reside?` → [en, que, ciudad, reside]. */
function palabras(v: string): string[] {
  return sinTildes(v).split(/[^a-z]+/).filter(Boolean)
}

/** Palabras que delatan un campo de ciudad, en español o en inglés. */
const PALABRAS_CIUDAD = new Set(['ciudad', 'city', 'municipio'])

/**
 * ¿Este campo del formulario pregunta la ciudad?
 *
 * Por PALABRA completa, no por subcadena: `electricity` o `ciudadania` no son ciudades.
 */
export function esCampoDeCiudad(name: string | undefined): boolean {
  return palabras(name ?? '').some((p) => PALABRAS_CIUDAD.has(p))
}

/**
 * El texto crudo de la ciudad declarada, o `null` si el formulario no la trae.
 *
 * Gana el primer campo de ciudad con valor, en el orden del formulario.
 */
export function ciudadDeclarada(fieldData: CampoFormulario[] | null | undefined): string | null {
  if (!Array.isArray(fieldData)) return null
  for (const fd of fieldData) {
    if (!esCampoDeCiudad(fd?.name)) continue
    const v = fd.values?.[0]
    if (typeof v === 'string' && v.trim()) return v
  }
  return null
}

// ── Catálogo ─────────────────────────────────────────────────────────────────

/**
 * El nombre del DANE que nadie escribe, a su forma común. Sin esto `Santiago de Cali`
 * y `Cali` serían dos columnas.
 */
const NOMBRE_COMUN: Record<string, string> = {
  'santiago de cali': 'cali',
  'san jose de cucuta': 'cucuta',
  'cartagena de indias': 'cartagena',
}

const MUNICIPIOS: ReadonlySet<string> = new Set([
  ...Object.values(MUNICIPIOS_POR_DEPTO).flatMap((t) => Object.keys(t)),
  ...Object.values(NOMBRE_COMUN),
])

/** Lo que puede venir pegado al final de la ciudad y no es parte de ella. */
const SUFIJOS: string[][] = [
  ...Object.keys(DEPARTAMENTOS_DANE),
  'valle',
  'guajira',
  'san andres',
  'norte santander',
  'distrito capital',
  'colombia',
  'd c',
  'dc',
]
  .map((s) => s.split(' '))
  // El más largo primero: `valle del cauca` antes que `cauca`.
  .sort((a, b) => b.length - a.length)

/** Conectores que no se capitalizan en el nombre que se muestra. */
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'el'])

export interface CiudadNormalizada {
  /** Llave de agrupación: sin tildes, en minúsculas, sin departamento. */
  clave: string
  /** La misma ciudad como la escribió la persona (con sus tildes), en minúsculas. */
  variante: string
}

/**
 * Normaliza una ciudad declarada. `null` si no queda nada que se pueda llamar ciudad
 * (vacía, solo signos o solo números).
 */
export function normalizarCiudad(cruda: string | null | undefined): CiudadNormalizada | null {
  if (typeof cruda !== 'string') return null
  // Lo que va antes de la primera coma, guion, barra o paréntesis: `Cali, Valle`,
  // `Medellín - Antioquia`, `Neiva (Huila)`.
  const tramo = cruda.replace(/_/g, ' ').split(/[,;\-–/()|]/)[0] ?? ''
  const originales = tramo
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase())
  let llaves = originales.map(sinTildes)
  let n = originales.length
  if (n === 0) return null

  // Suelta departamentos (y «Colombia», «D.C.») del final mientras quede algo y lo que
  // hay no sea ya un municipio con ese nombre completo.
  for (;;) {
    const actual = llaves.slice(0, n).join(' ')
    if (MUNICIPIOS.has(actual) || NOMBRE_COMUN[actual]) break
    const sufijo = SUFIJOS.find(
      (s) => s.length < n && llaves.slice(n - s.length, n).join(' ') === s.join(' '),
    )
    if (!sufijo) break
    n -= sufijo.length
  }
  llaves = llaves.slice(0, n)

  const base = llaves.join(' ')
  const comun = NOMBRE_COMUN[base]
  if (comun) return { clave: comun, variante: comun }
  return { clave: base, variante: originales.slice(0, n).join(' ') }
}

/** `san josé del guaviare` → `San José del Guaviare`. */
export function nombreParaMostrar(variante: string): string {
  return variante
    .split(' ')
    .map((p, i) => (i > 0 && CONECTORES.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

const tieneTildes = (v: string) => /[^\x00-\x7f]/.test(v)

/**
 * Junta las variantes de una misma clave y decide con qué nombre se muestra.
 *
 * Gana la variante CON tildes más frecuente; si nadie la escribió con tildes, la más
 * frecuente sin ellas. Así `medellín` (84) y `medellin` (78) se muestran «Medellín»
 * sin mantener una lista de nombres bonitos que se queda corta el primer día.
 */
export class NombresDeCiudad {
  private conteo = new Map<string, Map<string, number>>()

  /** Registra una ciudad y devuelve su clave (o `null` si no hay ciudad). */
  registrar(cruda: string | null | undefined): string | null {
    const c = normalizarCiudad(cruda)
    if (!c) return null
    const vs = this.conteo.get(c.clave) ?? new Map<string, number>()
    vs.set(c.variante, (vs.get(c.variante) ?? 0) + 1)
    this.conteo.set(c.clave, vs)
    return c.clave
  }

  nombre(clave: string): string {
    const vs = [...(this.conteo.get(clave) ?? new Map<string, number>()).entries()]
    if (vs.length === 0) return nombreParaMostrar(clave)
    vs.sort(
      (a, b) =>
        Number(tieneTildes(b[0])) - Number(tieneTildes(a[0])) ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0]),
    )
    return nombreParaMostrar(vs[0][0])
  }
}
