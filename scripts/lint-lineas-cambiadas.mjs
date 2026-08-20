#!/usr/bin/env node
// Trinquete de lint: corre eslint sobre los archivos que toca el PR, pero solo
// BLOQUEA por lo que cae en lineas que el PR agrego o modifico.
//
// Por que existe: la version anterior revisaba el archivo completo, asi que
// tocar una linea de un archivo que ya venia sucio ponia el PR en rojo por
// deuda ajena al cambio. Paso en el PR #336 — 4 de 10 correcciones se quedaron
// afuera por 15 errores heredados. Un check que castiga arreglar algo empuja a
// no tocar nada.
//
// Limite conocido: un cambio puede provocar un error que eslint reporta en otra
// linea (borras el ultimo uso de un import y el error sale en el import, que no
// tocaste). Eso NO bloquea. A cambio, la deuda vieja se reporta abajo como
// informativa para que siga a la vista.
//
// Uso: node scripts/lint-lineas-cambiadas.mjs <base-ref>

import { execFileSync } from 'node:child_process'
import { ESLint } from 'eslint'
import path from 'node:path'

const base = process.argv[2] || process.env.BASE_REF
if (!base) {
  console.error('Falta la base de comparacion. Uso: node scripts/lint-lineas-cambiadas.mjs origin/main')
  process.exit(2)
}

const EXTENSIONES = /\.(ts|tsx|js|jsx|mjs|cjs)$/

const git = (args) => execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })

const archivos = git(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`])
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s && EXTENSIONES.test(s))

if (archivos.length === 0) {
  console.log('El PR no toca archivos de codigo. Nada que revisar.')
  process.exit(0)
}

// Lineas que el PR agrego o modifico, por archivo. Del lado "+" del diff:
// las lineas borradas no tienen a donde apuntar en el arbol nuevo.
function lineasTocadas(archivo) {
  const diff = git(['diff', '--unified=0', `${base}...HEAD`, '--', archivo])
  const rangos = []
  for (const linea of diff.split('\n')) {
    const m = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(linea)
    if (!m) continue
    const inicio = Number(m[1])
    const cuantas = m[2] === undefined ? 1 : Number(m[2])
    if (cuantas === 0) continue // solo borrado: no hay linea nueva que culpar
    rangos.push([inicio, inicio + cuantas - 1])
  }
  return rangos
}

const cae = (rangos, msg) => {
  const desde = msg.line ?? 0
  const hasta = msg.endLine ?? desde
  return rangos.some(([a, b]) => desde <= b && hasta >= a)
}

const eslint = new ESLint()

const noIgnorados = []
for (const a of archivos) {
  if (await eslint.isPathIgnored(a)) continue
  noIgnorados.push(a)
}

if (noIgnorados.length === 0) {
  console.log('Todos los archivos del PR estan en la lista de ignorados de eslint. Nada que revisar.')
  process.exit(0)
}

console.log('Revisando:')
for (const a of noIgnorados) console.log(`  ${a}`)
console.log('')

const resultados = await eslint.lintFiles(noIgnorados)

let bloquean = 0
let heredados = 0
let avisos = 0
const salida = []
const deuda = new Map()

for (const r of resultados) {
  const rel = path.relative(process.cwd(), r.filePath)
  const rangos = lineasTocadas(rel)
  const propios = []

  for (const m of r.messages) {
    if (cae(rangos, m)) {
      if (m.severity === 2) bloquean++
      else avisos++
      propios.push(m)
    } else if (m.severity === 2) {
      heredados++
      deuda.set(rel, (deuda.get(rel) ?? 0) + 1)
    }
  }

  if (propios.length) {
    salida.push(`\n${rel}`)
    for (const m of propios) {
      const nivel = m.severity === 2 ? 'error  ' : 'warning'
      salida.push(`  ${String(m.line).padStart(4)}:${m.column}  ${nivel}  ${m.message}  ${m.ruleId ?? ''}`)
    }
  }
}

if (salida.length) console.log(salida.join('\n'))

if (heredados > 0) {
  console.log(`\n--- Deuda vieja en estos archivos: ${heredados} error(es) en lineas que el PR no toca ---`)
  console.log('No bloquean. Se listan para que no desaparezcan de la vista.')
  for (const [archivo, n] of [...deuda].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${archivo}`)
  }
}

console.log('')
if (bloquean > 0) {
  console.log(`✖ ${bloquean} error(es) en lineas que este PR cambia.`)
  process.exit(1)
}
console.log(`✔ Sin errores en las lineas que cambia este PR${avisos ? ` (${avisos} aviso(s))` : ''}.`)
