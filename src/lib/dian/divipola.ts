/**
 * DIVIPOLA (DANE) — códigos de país / departamento / municipio para las casillas
 * 26 / 27 / 28 del Formato 010 y para el cliente de Siigo.
 *
 * Motivación: la extracción del RUT trae los códigos de ubicación de forma poco
 * fiable (se midió `codigo_departamento` con el código de PAÍS y `codigo_municipio`
 * con un sufijo suelto). Los códigos SÍ son deterministas dado el NOMBRE, que se
 * extrae bien, así que se resuelven por nombre.
 *
 * El catálogo ya NO se escribe a mano: son los 1.122 municipios oficiales, en
 * `divipola-catalogo.generated.ts`, producidos por `scripts/generar-divipola.ts`
 * desde el DANE. La tabla anterior cubría ~50 municipios elegidos a dedo y dejaba
 * sin resolver 11 de los que aparecen en los RUT reales de SOENA (medido el
 * 2026-08-09), dos de ellos homónimos entre departamentos.
 *
 * Tres reglas que gobiernan la resolución:
 *
 * 1. **El departamento manda.** Con nombre de departamento, el municipio se busca
 *    dentro de él. Así "Barbosa" no elige entre Antioquia y Santander a la suerte.
 * 2. **Un homónimo sin departamento NO se resuelve.** 67 nombres se repiten entre
 *    departamentos; elegir uno es inventar el dato, y este dato viaja a la DIAN.
 * 3. **El nombre común se acepta si es inequívoco.** El DANE nombra "Santiago de
 *    Cali" y "Cartagena de Indias"; los RUT dicen "Cali" y "Cartagena". Se acepta
 *    un nombre contenido como palabra completa SOLO si dentro del departamento
 *    hay exactamente un municipio que lo cumple.
 */

import {
  DEPARTAMENTOS_DANE,
  MUNICIPIOS_POR_DEPTO,
  MUNICIPIOS_UNICOS,
} from './divipola-catalogo.generated'
import { normalizeNombreUbicacion } from './normalizar-ubicacion'

export const CODIGO_PAIS_COLOMBIA = '169'

export { normalizeNombreUbicacion }

/**
 * Formas coloquiales de un DEPARTAMENTO que no coinciden con el nombre oficial.
 * Los municipios NO necesitan esta lista: los resuelve la regla 3.
 */
const ALIAS_DEPARTAMENTO: Record<string, string> = {
  'valle': '76',
  'guajira': '44',
  'san andres': '88',
  'san andres y providencia': '88',
  'archipielago de san andres': '88',
  'bogota dc': '11',
  'distrito capital': '11',
  'norte santander': '54',
}

function codigoDepartamento(nombre: string): string | null {
  if (!nombre) return null
  return DEPARTAMENTOS_DANE[nombre] ?? ALIAS_DEPARTAMENTO[nombre] ?? null
}

/** ¿`corto` aparece dentro de `oficial` como secuencia de palabras completas? */
function esNombreCortoDe(corto: string, oficial: string): boolean {
  if (!corto) return false
  return ` ${oficial} `.includes(` ${corto} `)
}

/**
 * Municipio dentro de un departamento conocido. Exacto primero; si no, el nombre
 * común (regla 3) y solo cuando el candidato es único.
 */
function municipioEnDepto(dep: string, nombre: string): string | null {
  const tabla = MUNICIPIOS_POR_DEPTO[dep]
  if (!tabla || !nombre) return null
  if (tabla[nombre]) return tabla[nombre]

  const candidatos = Object.keys(tabla).filter(oficial => esNombreCortoDe(nombre, oficial))
  return candidatos.length === 1 ? tabla[candidatos[0]] : null
}

export interface CodigosUbicacion {
  codigo_pais: string | null
  codigo_departamento: string | null
  codigo_municipio: string | null
}

/**
 * Resuelve los códigos DANE a partir de los NOMBRES (país/departamento/municipio).
 * Precedencia por campo: nombre resuelto > código extraído (fallback) > null.
 *
 * Nunca inventa: si el municipio no se puede determinar sin ambigüedad, devuelve
 * lo extraído (que el operador puede corregir) o null, jamás un código a la suerte.
 */
export function resolverCodigosUbicacion(
  pais: string | null | undefined,
  departamento: string | null | undefined,
  municipio: string | null | undefined,
  extraidos?: Partial<CodigosUbicacion>,
): CodigosUbicacion {
  const nPais = normalizeNombreUbicacion(pais)
  const nDep = normalizeNombreUbicacion(departamento)
  const nMun = normalizeNombreUbicacion(municipio)

  const codigo_pais = nPais.includes('colombia') ? CODIGO_PAIS_COLOMBIA : (extraidos?.codigo_pais ?? null)

  const depPorNombre = codigoDepartamento(nDep)

  // Con departamento: se busca dentro de él y no se mira nada más. Sin él: solo
  // valen los nombres únicos en todo el país (los 67 homónimos quedan sin resolver).
  let dep: string | null = depPorNombre
  let mun: string | null = null

  if (depPorNombre) {
    mun = municipioEnDepto(depPorNombre, nMun)
  } else {
    const unico = MUNICIPIOS_UNICOS[nMun]
    if (unico) {
      dep = unico.dep
      mun = unico.mun
    }
  }

  return {
    codigo_pais,
    codigo_departamento: dep ?? extraidos?.codigo_departamento ?? null,
    codigo_municipio: mun ?? extraidos?.codigo_municipio ?? null,
  }
}
