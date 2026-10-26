#!/usr/bin/env node
// Guarda: una migracion que puede romper a las pestañas viejas exige subir la EPOCA.
//
// Desde el 2026-10-03 un deploy normal ya NO recarga la pestaña abierta (ver
// `src/lib/version/epoca.ts`). Skew Protection le sigue sirviendo a esa pestaña su propio
// codigo — assets, navegaciones, server actions — hasta 8 horas (el techo del vigilante).
// Lo que no se versiona es la base de datos: es una sola. Y las migraciones se aplican
// ANTES del merge, asi que una pestaña vieja puede correr codigo viejo contra el esquema
// nuevo durante horas, no los ~5 minutos de antes.
//
// La salida es la epoca: el PR que rompe sube `EPOCA` y todas las pestañas viejas se
// recargan (o avisan, si hay trabajo en curso) en la siguiente consulta a `/api/version`.
// Esta guarda la exige cuando una migracion NUEVA del PR trae algo que deja al codigo viejo
// sin lo que espera:
//
//   - DROP de tabla, vista, vista materializada, funcion, procedimiento, tipo o esquema;
//   - DROP de columna (con o sin la palabra COLUMN);
//   - RENAME de tabla, vista, columna, funcion, procedimiento, tipo o esquema
//     (renombrar una restriccion, un indice o un trigger no le cambia nada al codigo);
//   - ALTER COLUMN ... TYPE (o SET DATA TYPE).
//
// Pasa si la epoca SUBE en el mismo PR, o si la migracion declara que no rompe:
//
//     -- epoca: no-rompe <motivo>
//
// La marca es la decision, el silencio no (mismo contrato que `-- server-only:` en la
// guarda de grants). Ejemplos de motivo legitimo: "el DROP FUNCTION recrea la misma firma
// en este archivo", "la columna dejo de leerse en #123, mergeado hace una semana".
//
// Sesgo deliberado: prefiere el falso positivo. Un DROP dentro del cuerpo de una funcion o
// en un texto se reporta igual; cuesta una linea de marca. Un falso negativo cuesta una
// pestaña reventando contra el esquema nuevo.
//
// ALCANCE: solo los archivos que el PR AGREGA (o renombra), como las otras dos guardas. Las
// migraciones viejas ya se aplicaron; marcarlas no protege a nadie.
//
// Uso:
//   node scripts/check-migracion-epoca.mjs                       # lo que el PR agrega (CI)
//   node scripts/check-migracion-epoca.mjs --todas               # el directorio entero (solo mide)
//   node scripts/check-migracion-epoca.mjs a.sql b.sql           # rutas explicitas

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)

function opcion(nombre) {
  const i = argv.indexOf(nombre)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null
}

const DIR = opcion('--dir') ?? 'supabase/migrations'
const ARCHIVO_EPOCA = opcion('--epoca') ?? 'src/lib/version/epoca.ts'
const base = process.env.BASE_REF || 'origin/main'
const todas = argv.includes('--todas')

const MARCA = /^[ \t]*--[ \t]*epoca[ \t]*:[ \t]*no-rompe[ \t]+([^\s][^\n]{2,})$/im

// ── Lectura del SQL ──────────────────────────────────────────────────────────────────

// Quita comentarios `--` y `/* */` conservando los saltos de linea (para reportar la linea
// correcta). No toca textos ni cuerpos `$$`: un DO block que borra una columna la borra.
export function sinComentarios(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (sql[i] === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] === '\n') out += '\n'
        i++
      }
      i += 2
      continue
    }
    out += sql[i]
    i++
  }
  return out
}

function lineaDe(texto, indice) {
  return texto.slice(0, indice).split('\n').length
}

// El texto de la sentencia que contiene `indice`, desde el `;` anterior.
function sentenciaHasta(texto, indice) {
  const inicio = texto.lastIndexOf(';', indice) + 1
  return texto.slice(inicio, indice)
}

const OBJETOS_DROP = /^(TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TYPE|SCHEMA)\b/i
// Lo que se puede soltar sin dejar al codigo viejo sin algo que lee o llama.
const DROP_INOFENSIVO =
  /^(CONSTRAINT|DEFAULT|NOT\s+NULL|IDENTITY|EXPRESSION|POLICY|TRIGGER|INDEX|SEQUENCE|RULE|EXTENSION|PUBLICATION|SUBSCRIPTION|OWNED|ROLE|USER|SERVER|STATISTICS|EVENT\s+TRIGGER|CAST|OPERATOR|AGGREGATE|DOMAIN|COLLATION|CONVERSION|TEXT\s+SEARCH|FOREIGN\s+DATA|ACCESS\s+METHOD|LANGUAGE|TRANSFORM)\b/i
const ALTER_QUE_RENOMBRA_ALGO_LEIDO =
  /\bALTER\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TYPE|SCHEMA)\b/i

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`
const NOMBRE = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`

function normalizarNombre(nombre) {
  return nombre
    .replace(/\s+/g, '')
    .replace(/"/g, '')
    .toLowerCase()
    .replace(/^public\./, '')
}

// Vistas y funciones que el MISMO archivo vuelve a crear. `DROP VIEW v; CREATE VIEW v AS ...`
// es la forma de cambiarle columnas a una vista (CREATE OR REPLACE no deja quitar ni
// reordenar), y `DROP FUNCTION f(...); CREATE FUNCTION f(...)` la de cambiarle el retorno.
// Medido el 2026-10-03 sobre las 484 migraciones del repo: 80 de los hallazgos eran esto, y
// exigir la marca en cada una le enseña a la gente a ponerla sin leer. Quedan como aviso.
function recreadas(t) {
  const set = new Set()
  const re = new RegExp(
    String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?(VIEW|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?${NOMBRE}`,
    'gi',
  )
  for (const m of t.matchAll(re)) set.add(`${m[1].toUpperCase()} ${normalizarNombre(m[2])}`)
  return set
}

/** Lo que una migracion trae que puede romper al codigo viejo. `[{ linea, que }]`. */
export function cambiosQueRompen(sql) {
  return analizar(sql).hallazgos
}

/**
 * `hallazgos`: lo que exige subir la epoca o declarar la marca.
 * `avisos`: vistas o funciones borradas y recreadas en el mismo archivo. No frenan, pero
 * se imprimen: si la vista nueva pierde una columna o la funcion cambia sus argumentos
 * obligatorios, eso SI rompe y la guarda no lo puede ver.
 */
export function analizar(sql) {
  const t = sinComentarios(sql)
  const hallazgos = []
  const avisos = []
  const vuelven = recreadas(t)

  for (const m of t.matchAll(/\bDROP\s+/gi)) {
    const resto = t.slice(m.index + m[0].length)
    const objeto = resto.match(OBJETOS_DROP)
    if (objeto) {
      const tipo = objeto[1].toUpperCase().replace(/\s+/g, ' ')
      const linea = lineaDe(t, m.index)
      const nombre = resto
        .slice(objeto[0].length)
        .match(new RegExp(String.raw`^\s+(?:IF\s+EXISTS\s+)?${NOMBRE}`, 'i'))
      const base = tipo === 'MATERIALIZED VIEW' ? 'VIEW' : tipo
      if (
        nombre &&
        (base === 'VIEW' || base === 'FUNCTION' || base === 'PROCEDURE') &&
        vuelven.has(`${base} ${normalizarNombre(nombre[1])}`)
      ) {
        avisos.push({ linea, que: `DROP ${tipo} ${normalizarNombre(nombre[1])} (se recrea en el archivo)` })
        continue
      }
      hallazgos.push({ linea, que: `DROP ${tipo}` })
      continue
    }
    if (/^COLUMN\b/i.test(resto)) {
      hallazgos.push({ linea: lineaDe(t, m.index), que: 'DROP COLUMN' })
      continue
    }
    if (DROP_INOFENSIVO.test(resto)) continue
    // `ALTER TABLE t DROP c` (sin COLUMN) tambien borra una columna.
    if (/\bALTER\s+TABLE\b/i.test(sentenciaHasta(t, m.index))) {
      hallazgos.push({ linea: lineaDe(t, m.index), que: 'DROP COLUMN' })
    }
  }

  for (const m of t.matchAll(/\bRENAME\b/gi)) {
    const resto = t.slice(m.index + m[0].length)
    if (/^\s+CONSTRAINT\b/i.test(resto)) continue
    const sentencia = sentenciaHasta(t, m.index)
    const alter = sentencia.match(ALTER_QUE_RENOMBRA_ALGO_LEIDO)
    if (!alter) continue
    const que = /^\s+TO\b/i.test(resto)
      ? `RENAME de ${alter[1].toUpperCase().replace(/\s+/g, ' ')}`
      : 'RENAME de columna o valor'
    hallazgos.push({ linea: lineaDe(t, m.index), que })
  }

  for (const m of t.matchAll(
    /\bALTER\s+(?:COLUMN\s+)?(?:"[^"]+"|[A-Za-z_][\w$]*)\s+(?:SET\s+DATA\s+)?TYPE\b/gi,
  )) {
    hallazgos.push({ linea: lineaDe(t, m.index), que: 'ALTER COLUMN ... TYPE' })
  }

  return {
    hallazgos: hallazgos.sort((a, b) => a.linea - b.linea),
    avisos: avisos.sort((a, b) => a.linea - b.linea),
  }
}

/** El motivo de la marca `-- epoca: no-rompe <motivo>`, o null. */
export function marcaNoRompe(sql) {
  const m = sql.match(MARCA)
  return m ? m[1].trim() : null
}

/** El valor de `EPOCA` en el texto de `epoca.ts`, o null si no se encuentra. */
export function leerEpocaDe(texto) {
  if (typeof texto !== 'string') return null
  const m = texto.match(/export\s+const\s+EPOCA\s*(?::\s*number\s*)?=\s*(\d+)\b/)
  return m ? Number(m[1]) : null
}

// ── Git ──────────────────────────────────────────────────────────────────────────────

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

// La epoca en la BASE del PR (el ancestro comun, igual que `base...HEAD`). Si el archivo no
// existia ahi, la base cuenta como "sin epoca": cualquier valor del PR es una subida.
function epocaEnLaBase() {
  try {
    const mb = execSync(`git merge-base ${base} HEAD`, { encoding: 'utf8' }).trim()
    const texto = execSync(`git show ${mb}:${ARCHIVO_EPOCA}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return leerEpocaDe(texto)
  } catch {
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────────────

function main() {
  const explicitos = argv.filter((a) => a.toLowerCase().endsWith('.sql'))
  const aRevisar = explicitos.length
    ? explicitos
    : todas
      ? readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.sql')).map((f) => join(DIR, f))
      : archivosNuevosDelPr()

  if (aRevisar.length === 0) {
    console.log('Guarda de epoca: el PR no agrega migraciones.')
    return
  }

  const conRiesgo = []
  const declaradas = []
  for (const archivo of aRevisar) {
    const sql = readFileSync(archivo, 'utf8')
    const { hallazgos, avisos } = analizar(sql)
    for (const a of avisos) {
      console.log(`  ! ${archivo} linea ${a.linea}: ${a.que}. Revisa que no quite columnas ni argumentos.`)
    }
    if (hallazgos.length === 0) continue
    const motivo = marcaNoRompe(sql)
    if (motivo) declaradas.push({ archivo, motivo })
    else conRiesgo.push({ archivo, hallazgos })
  }

  for (const d of declaradas) console.log(`  · ${d.archivo}: declarada no-rompe (${d.motivo})`)

  if (conRiesgo.length === 0) {
    console.log(`Guarda de epoca: ${aRevisar.length} migracion(es) revisada(s), ninguna exige subir la epoca.`)
    return
  }

  // `--todas` es para medir: el historico ya se aplico y no hay PR contra el cual comparar
  // la epoca. Solo se reporta.
  if (todas) {
    for (const r of conRiesgo) {
      console.log(`  ✗ ${r.archivo}: ${r.hallazgos.map((h) => `${h.que} (linea ${h.linea})`).join(', ')}`)
    }
    console.log(`\n${conRiesgo.length} de ${aRevisar.length} migraciones exigirian subir la epoca.`)
    return
  }

  if (!existsSync(ARCHIVO_EPOCA)) {
    console.error(`No se encontro ${ARCHIVO_EPOCA}: la guarda no puede saber si la epoca subio.`)
    process.exit(2)
  }
  const ahora = leerEpocaDe(readFileSync(ARCHIVO_EPOCA, 'utf8'))
  if (ahora === null) {
    console.error(`No se pudo leer "export const EPOCA = <entero>" en ${ARCHIVO_EPOCA}.`)
    process.exit(2)
  }
  const antes = epocaEnLaBase()
  if (antes === null || ahora > antes) {
    console.log(
      `Guarda de epoca: la epoca sube (${antes ?? '—'} → ${ahora}); las pestañas viejas se recargaran. ` +
        `${conRiesgo.length} migracion(es) lo exigian.`,
    )
    return
  }

  console.error(`\nGuarda de epoca: ${conRiesgo.length} migracion(es) pueden romper a las pestañas abiertas\n`)
  for (const r of conRiesgo) {
    console.error(`  ✗ ${r.archivo}`)
    for (const h of r.hallazgos) console.error(`      linea ${h.linea}: ${h.que}`)
  }
  console.error(
    `\nUn deploy normal ya no recarga las pestañas: una pestaña abierta puede seguir hasta 8 horas\n` +
      `con el codigo de antes, y la migracion se aplica antes del merge. Si ese codigo lee o llama\n` +
      `lo que esta migracion borra, renombra o cambia de tipo, revienta.\n\n` +
      `Que hacer, una de dos:\n` +
      `  1. Sube EPOCA en ${ARCHIVO_EPOCA} (hoy ${ahora}) en este mismo PR: todas las pestañas\n` +
      `     viejas se recargan solas (o avisan, si alguien esta escribiendo).\n` +
      `  2. Si de verdad no rompe, declaralo en la migracion:\n` +
      `       -- epoca: no-rompe <motivo>\n` +
      `     (por ejemplo: "el DROP FUNCTION recrea la misma firma en este archivo").\n`,
  )
  process.exit(1)
}

// Se ejecuta como script; las pruebas importan las funciones sin correr `main`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
