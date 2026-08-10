/**
 * Genera el catálogo DIVIPOLA completo desde la fuente oficial (DANE vía
 * datos.gov.co) hacia `src/lib/dian/divipola-catalogo.generated.ts`.
 *
 * Por qué generado y no escrito a mano: la tabla anterior cubría ~50 municipios
 * elegidos a dedo y cada RUT de un municipio nuevo obligaba a agregar una línea.
 * Medido el 2026-08-09 sobre los negocios abiertos de SOENA, 11 municipios de los
 * RUT reales no resolvían su código DANE, y dos de ellos (Barbosa, La Unión) son
 * homónimos en varios departamentos: escribirlos a mano es justo donde se cuela
 * el código equivocado.
 *
 * Un código DANE mal puesto viaja a la DIAN (casillas 26-28 del 010) y a la
 * factura electrónica de Siigo, así que la tabla NO se teclea: se deriva.
 *
 * Uso:  npx tsx scripts/generar-divipola.ts
 *       (idempotente; correr de nuevo si el DANE actualiza el catálogo)
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeNombreUbicacion } from '../src/lib/dian/normalizar-ubicacion'

const FUENTE = 'https://www.datos.gov.co/resource/gdxc-w37w.json'
const DESTINO = join(process.cwd(), 'src/lib/dian/divipola-catalogo.generated.ts')

interface FilaDane {
  cod_dpto: string
  dpto: string
  cod_mpio: string
  nom_mpio: string
}

async function descargar(): Promise<FilaDane[]> {
  // El dataset trae ~1.120 filas; se pide con holgura y se valida el tamaño para
  // no generar un catálogo truncado que pasaría por bueno.
  const res = await fetch(`${FUENTE}?$limit=5000`)
  if (!res.ok) throw new Error(`DANE respondió ${res.status}`)
  const filas = (await res.json()) as FilaDane[]
  if (filas.length < 1000) {
    throw new Error(`El catálogo llegó con ${filas.length} filas: se esperaban ~1.120. Abortado para no truncar la tabla.`)
  }
  return filas
}

function generar(filas: FilaDane[]): string {
  const departamentos: Record<string, string> = {}
  // dep2 -> { municipio normalizado -> mun3 }
  const porDepto: Record<string, Record<string, string>> = {}
  // nombre normalizado -> departamentos donde existe (para detectar homónimos)
  const apariciones = new Map<string, Set<string>>()

  for (const f of filas) {
    const dep2 = f.cod_dpto.padStart(2, '0')
    // `cod_mpio` viene completo (5 dígitos: departamento + municipio).
    const mun3 = f.cod_mpio.padStart(5, '0').slice(2)
    const nomDep = normalizeNombreUbicacion(f.dpto)
    const nomMun = normalizeNombreUbicacion(f.nom_mpio)
    if (!nomDep || !nomMun) continue

    departamentos[nomDep] = dep2
    porDepto[dep2] ??= {}
    porDepto[dep2][nomMun] = mun3

    if (!apariciones.has(nomMun)) apariciones.set(nomMun, new Set())
    apariciones.get(nomMun)!.add(dep2)
  }

  // Índice para resolver sin nombre de departamento: SOLO nombres que existen en
  // un único departamento. Un homónimo se deja sin resolver a propósito: elegir
  // uno de dos municipios reales es inventar el dato.
  const unicos: Record<string, { dep: string; mun: string }> = {}
  for (const [nombre, deps] of apariciones) {
    if (deps.size !== 1) continue
    const dep = [...deps][0]
    unicos[nombre] = { dep, mun: porDepto[dep][nombre] }
  }

  const ambiguos = [...apariciones.entries()].filter(([, d]) => d.size > 1).map(([n]) => n).sort()

  const j = (v: unknown) => JSON.stringify(v, null, 2)
  return `// GENERADO POR scripts/generar-divipola.ts — NO EDITAR A MANO.
// Fuente: DANE (DIVIPOLA) vía datos.gov.co, dataset gdxc-w37w.
// Municipios: ${filas.length}. Nombres que se repiten entre departamentos: ${ambiguos.length}.
//
// Para actualizar: npx tsx scripts/generar-divipola.ts

/** Nombre de departamento normalizado -> código DANE de 2 dígitos. */
export const DEPARTAMENTOS_DANE: Record<string, string> = ${j(departamentos)}

/** Código de departamento -> { nombre de municipio normalizado -> código de 3 dígitos }. */
export const MUNICIPIOS_POR_DEPTO: Record<string, Record<string, string>> = ${j(porDepto)}

/**
 * Municipios cuyo nombre es único en todo el país. Solo estos se pueden resolver
 * sin conocer el departamento; los homónimos quedan fuera a propósito.
 */
export const MUNICIPIOS_UNICOS: Record<string, { dep: string; mun: string }> = ${j(unicos)}

/** Nombres de municipio que existen en más de un departamento. */
export const MUNICIPIOS_AMBIGUOS: readonly string[] = ${j(ambiguos)}
`
}

async function main() {
  const filas = await descargar()
  writeFileSync(DESTINO, generar(filas), 'utf8')
  const deps = new Set(filas.map(f => f.cod_dpto)).size
  console.log(`Catálogo escrito en ${DESTINO}`)
  console.log(`  ${filas.length} municipios en ${deps} departamentos`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
