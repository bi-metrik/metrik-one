#!/usr/bin/env node
// Guarda: dos archivos de migracion no pueden compartir el mismo numero de VERSION.
//
// Supabase identifica una migracion por lo que va ANTES del primer guion bajo del nombre,
// no por el nombre completo. Si dos archivos declaran la misma version, `db push` da ese
// numero por aplicado en cuanto corre el primero y **salta el resto en silencio**: sin
// error, sin aviso, sin nada en el log. La migracion que se perdio no se distingue de una
// que nunca se escribio.
//
// No es hipotetico. La version `20260630000001` la comparten TRES archivos
// (`plan_cobro_cuotas`, `security_advisors_ola1`, `security_ola2_revoke_anon_execute`), y se
// verifico contra produccion que `plan_cobro_cuotas` si se aplico y `security_advisors_ola1`
// NUNCA: las 3 funciones que debia tocar siguen sin `search_path` fijo desde junio.
// CLAUDE.md ya pedia esta guarda por escrito ("Merece un check de CI que rechace versiones
// duplicadas: es la unica de las dos fallas que no se ve").
//
// ALCANCE: solo los archivos que el PR AGREGA o RENOMBRA, comparados contra el directorio
// completo. Es deliberado y es lo que hace que la guarda sirva:
//
//   - `main` ya arrastra 32 versiones repetidas entre 70 archivos. Una guarda que mire todo
//     el directorio nace ROJA y se vuelve ruido — el repo ya decidio lo contrario dos veces
//     (`check-migracion-grants.mjs` mira solo lo que el PR agrega, `lint-lineas-cambiadas.mjs`
//     solo las lineas que toca), y las dos lo dicen en su encabezado: "un check que nace rojo
//     entrena a ignorarlo". Esto es el mismo trinquete: el historico queda congelado y lo
//     nuevo entra limpio.
//   - Una lista de excepciones seria peor que el trinquete, no solo mas trabajo: si enumera
//     versiones, un CUARTO archivo sobre `20260825000001` (que hoy ya tiene tres) pasaria sin
//     que nadie lo vea, que es justo el fallo que esto viene a cerrar. Y si enumera juegos
//     exactos de archivos, cualquier borrado o renombre legitimo de una migracion vieja pone
//     la guarda en rojo por una razon que no tiene que ver con el PR.
//
// El archivo nuevo se compara contra el DIRECTORIO ENTERO, no solo contra los otros archivos
// del PR: el choque peligroso es justamente contra una migracion que ya vive en `main`.
//
// Uso:
//   node scripts/check-migracion-version-duplicada.mjs                 # lo que el PR agrega (CI)
//   node scripts/check-migracion-version-duplicada.mjs --todas         # el directorio completo
//   node scripts/check-migracion-version-duplicada.mjs --dir D a.sql   # rutas explicitas (pruebas)

import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

const argv = process.argv.slice(2)

function opcion(nombre) {
  const i = argv.indexOf(nombre)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null
}

const DIR = opcion('--dir') ?? 'supabase/migrations'
const base = process.env.BASE_REF || 'origin/main'
const todas = argv.includes('--todas')

// La version es lo que va antes del PRIMER guion bajo. Un nombre sin guion bajo no es la
// forma que usa el repo (los 428 archivos son `^[0-9]{14}_...`), pero si aparece uno se toma
// el nombre completo sin extension: mejor tratarlo como version propia que ignorarlo.
function versionDe(ruta) {
  const n = basename(ruta).replace(/\.sql$/i, '')
  const i = n.indexOf('_')
  return i === -1 ? n : n.slice(0, i)
}

function todosLosArchivos() {
  try {
    return readdirSync(DIR)
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .map((f) => join(DIR, f))
  } catch {
    console.error(`No se pudo leer ${DIR}.`)
    process.exit(2)
  }
}

// Archivos cuyo NOMBRE es nuevo en este PR. `--no-renames` no es cosmetico: sin el, git
// reporta un renombre como R y `--diff-filter=A` no lo ve, asi que renombrar una migracion
// vieja hacia una version ya ocupada se colaria. Con el flag, un renombre entra como D + A
// y el destino queda cubierto.
function archivosNuevosDelPr() {
  try {
    const out = execSync(
      `git diff --name-only --no-renames --diff-filter=A ${base}...HEAD -- ${DIR}`,
      { encoding: 'utf8' },
    )
    return out.split('\n').map((l) => l.trim()).filter((l) => l.toLowerCase().endsWith('.sql'))
  } catch {
    console.error(
      `No se pudo comparar contra ${base}. Usa --todas, pasa rutas explicitas, o define BASE_REF.`,
    )
    process.exit(2)
  }
}

const universo = todosLosArchivos()

// Indice version -> archivos, sobre TODO el directorio.
const porVersion = new Map()
for (const a of universo) {
  const v = versionDe(a)
  if (!porVersion.has(v)) porVersion.set(v, [])
  porVersion.get(v).push(a)
}

const explicitos = argv.filter((a) => a.toLowerCase().endsWith('.sql'))
const aRevisar = explicitos.length > 0 ? explicitos : todas ? universo : archivosNuevosDelPr()
// En modo `--todas` TODO el directorio esta bajo revision, asi que marcar cada archivo como
// "lo agrega este PR" seria falso. La marca solo tiene sentido cuando hay un subconjunto.
const nombresNuevos = todas ? new Set() : new Set(aRevisar.map((a) => basename(a)))

// Una version se reporta UNA vez, aunque el PR agregue dos archivos que la compartan.
const versionesVistas = new Set()
const problemas = []

for (const archivo of aRevisar) {
  const v = versionDe(archivo)
  if (versionesVistas.has(v)) continue
  versionesVistas.add(v)

  // Si el archivo no figura en el directorio (ruta de prueba fuera de `--dir`), se cuentan
  // las rutas explicitas que comparten su version, para no perder ese caso.
  const delDirectorio = porVersion.get(v) ?? []
  const listado =
    delDirectorio.length > 0 ? delDirectorio : aRevisar.filter((a) => versionDe(a) === v)
  if (listado.length < 2) continue

  const detalle = listado
    .map((a) => `      - ${basename(a)}${nombresNuevos.has(basename(a)) ? '   <-- lo agrega este PR' : ''}`)
    .join('\n')

  problemas.push(`la version "${v}" la comparten ${listado.length} archivos:\n${detalle}`)
}

if (problemas.length > 0) {
  console.error(`\nGuarda de versiones de migracion: ${problemas.length} version(es) repetida(s)\n`)
  for (const p of problemas) console.error(`  ✗ ${p}\n`)
  console.error(
    `Supabase identifica la migracion por el numero que va antes del primer guion bajo, no por\n` +
      `el nombre. Con la version repetida, \`db push\` da ese numero por aplicado al correr el\n` +
      `primer archivo y SALTA los demas en silencio: no hay error, y la migracion perdida no se\n` +
      `distingue de una que nunca se escribio.\n\n` +
      `Que hacer: renombra el archivo que agrega este PR a una version libre. El numero se elige\n` +
      `mirando el LEDGER de la base (select version from supabase_migrations.schema_migrations\n` +
      `order by version desc limit 5), no el directorio: otra sesion puede haber aplicado una\n` +
      `version que todavia no esta en main.\n`,
  )
  process.exit(1)
}

console.log(
  aRevisar.length === 0
    ? 'Guarda de versiones de migracion: el PR no agrega migraciones.'
    : `Guarda de versiones de migracion: ${aRevisar.length} archivo(s) revisado(s), sin versiones repetidas.`,
)
