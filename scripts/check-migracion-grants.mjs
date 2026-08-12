#!/usr/bin/env node
// Guarda: una migracion no puede crear una tabla sin decir quien la puede leer.
//
// Existe porque el default de la base concedia los siete privilegios a `anon` en cada tabla
// nueva, y porque a partir de esta tanda el default es el contrario: una tabla nueva no
// concede nada a nadie. Los dos extremos fallan del mismo modo si la migracion calla —
// antes quedaba abierta, ahora queda invisible — y en ambos casos el sintoma aparece lejos
// del commit que lo causo. Esta guarda obliga a que la migracion lo declare.
//
// Lo que exige a cada CREATE TABLE en `public` (incluido CREATE TABLE ... AS SELECT, que es
// la forma con la que nacieron los seis respaldos del 2026-08-09/10):
//
//   1. `alter table ... enable row level security`, siempre.
//   2. o un `grant ... to authenticated`, o la marca `-- server-only: <razon>`.
//   3. un `grant ... to anon` solo con la marca `-- publico-deliberado: <razon>`.
//
// Limite conocido y asumido: esto es analisis de texto, no un parser de SQL. Reconoce las
// formas que ONE usa en sus 279 migraciones; no cubre DDL generado dinamicamente ni SQL
// ofuscado. Es una red para el olvido honesto, no una defensa contra quien la quiera evadir
// — la defensa dura es el ALTER DEFAULT PRIVILEGES, que actua aunque nadie lea este script.

import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'
const base = process.env.BASE_REF || 'origin/main'
const todas = process.argv.includes('--todas')

function migracionesAEvaluar() {
  // Rutas explicitas: para probar la guarda contra casos conocidos, y para revisar un
  // archivo suelto sin depender del estado de git.
  const explicitos = process.argv.slice(2).filter((a) => a.endsWith('.sql'))
  if (explicitos.length > 0) return explicitos

  if (todas) return readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((f) => join(DIR, f))
  try {
    const out = execSync(`git diff --name-only --diff-filter=A ${base}...HEAD -- ${DIR}`, {
      encoding: 'utf8',
    })
    return out.split('\n').filter((l) => l.trim().endsWith('.sql'))
  } catch {
    console.error(`No se pudo comparar contra ${base}. Usa --todas o define BASE_REF.`)
    process.exit(2)
  }
}

// Quita comentarios de linea SALVO las marcas declarativas, que son parte del contrato.
function sinComentarios(sql) {
  return sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l) || /--\s*(server-only|publico-deliberado)\s*:/i.test(l))
    .join('\n')
}

// Nombres de tabla creados en public. Cubre `create table x`, `create table public.x`,
// `if not exists`, `unlogged`, y la forma `... as select`.
function tablasCreadas(sql) {
  const re = /create\s+(?:unlogged\s+|temp\s+|temporary\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi
  const out = new Set()
  for (const m of sql.matchAll(re)) {
    // Las temporales viven fuera de public y mueren con la sesion: no aplican.
    if (/temp|temporary/i.test(m[0])) continue
    out.add(m[1].toLowerCase())
  }
  return [...out]
}

const problemas = []
const archivos = migracionesAEvaluar()

for (const archivo of archivos) {
  let crudo
  try {
    crudo = readFileSync(archivo, 'utf8')
  } catch {
    continue // borrada en el mismo PR
  }
  const sql = sinComentarios(crudo)
  const tablas = tablasCreadas(sql)
  if (tablas.length === 0) continue

  const marcaServerOnly = /--\s*server-only\s*:\s*\S+/i.test(crudo)
  const marcaPublica = /--\s*publico-deliberado\s*:\s*\S+/i.test(crudo)

  for (const t of tablas) {
    const rls = new RegExp(`alter\\s+table\\s+(?:public\\.)?"?${t}"?[\\s\\S]{0,120}?enable\\s+row\\s+level\\s+security`, 'i').test(sql)
    if (!rls) {
      problemas.push(`${archivo}: la tabla "${t}" se crea sin "enable row level security".`)
    }

    const grantAuth = new RegExp(`grant[\\s\\S]{0,200}?on\\s+(?:table\\s+)?(?:public\\.)?"?${t}"?[\\s\\S]{0,80}?to[\\s\\S]{0,80}?authenticated`, 'i').test(sql)
    if (!grantAuth && !marcaServerOnly) {
      problemas.push(
        `${archivo}: la tabla "${t}" no otorga nada a "authenticated" ni declara "-- server-only: <razon>". ` +
          `Con el default vigente nace invisible para PostgREST aunque el RLS sea correcto.`,
      )
    }

    const grantAnon = new RegExp(`grant[\\s\\S]{0,200}?on\\s+(?:table\\s+)?(?:public\\.)?"?${t}"?[\\s\\S]{0,80}?to[\\s\\S]{0,80}?\\banon\\b`, 'i').test(sql)
    if (grantAnon && !marcaPublica) {
      problemas.push(
        `${archivo}: la tabla "${t}" otorga privilegios a "anon" sin declarar "-- publico-deliberado: <razon>". ` +
          `La anon key viaja en el bundle del browser.`,
      )
    }
  }
}

// Funciones. Van aparte de las tablas porque su default NO es corregible por
// ALTER DEFAULT PRIVILEGES: toda funcion nace con EXECUTE para PUBLIC por comportamiento
// nativo de PostgreSQL, y `anon` la alcanza como miembro de PUBLIC. Medido en la base el
// 2026-08-10. Para funciones, esta guarda no es una red de seguridad secundaria: es el
// unico mecanismo que queda.
//
// Por eso exige el revoke a PUBLIC y no acepta el revoke solo a `anon`, que es el error
// que CLAUDE.md ya documenta como gotcha (#185): deja la funcion alcanzable igual.
function funcionesCreadas(sql) {
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi
  return [...new Set([...sql.matchAll(re)].map((m) => m[1].toLowerCase()))]
}

for (const archivo of archivos) {
  let crudo
  try {
    crudo = readFileSync(archivo, 'utf8')
  } catch {
    continue
  }
  const sql = sinComentarios(crudo)
  const funciones = funcionesCreadas(sql)
  if (funciones.length === 0) continue

  const marcaCliente = /--\s*ejecutable-por-cliente\s*:\s*\S+/i.test(crudo)
  if (marcaCliente) continue

  for (const f of funciones) {
    const revocaPublic = new RegExp(
      `revoke\\s+(?:all|execute)[\\s\\S]{0,120}?on\\s+function[\\s\\S]{0,200}?\\b${f}\\b[\\s\\S]{0,120}?from[\\s\\S]{0,60}?\\bpublic\\b`,
      'i',
    ).test(sql)
    if (!revocaPublic) {
      const soloAnon = new RegExp(
        `revoke[\\s\\S]{0,120}?on\\s+function[\\s\\S]{0,200}?\\b${f}\\b[\\s\\S]{0,120}?from[\\s\\S]{0,60}?\\banon\\b`,
        'i',
      ).test(sql)
      problemas.push(
        `${archivo}: la funcion "${f}" ${soloAnon ? 'revoca EXECUTE solo a "anon", que NO basta' : 'no revoca EXECUTE a PUBLIC'}. ` +
          `Toda funcion nace ejecutable por PUBLIC y "anon" la alcanza por ahi; el default de la base no lo puede evitar. ` +
          `Agrega "revoke execute on function public.${f}(...) from public, anon;" o declara "-- ejecutable-por-cliente: <razon>".`,
      )
    }
  }
}

if (problemas.length > 0) {
  console.error(`\nGuarda de migraciones: ${problemas.length} problema(s)\n`)
  for (const p of problemas) console.error(`  ✗ ${p}`)
  console.error(
    `\nConvencion completa en CLAUDE.md, "Convenciones de base de datos".\n` +
      `Si la tabla es legitimamente server-only o legitimamente publica, decláralo con la marca\n` +
      `correspondiente en un comentario de la migracion. La marca es la decision; el silencio no.\n`,
  )
  process.exit(1)
}

console.log(
  archivos.length === 0
    ? 'Guarda de migraciones: no hay migraciones nuevas que revisar.'
    : `Guarda de migraciones: ${archivos.length} archivo(s) revisado(s), sin problemas.`,
)
