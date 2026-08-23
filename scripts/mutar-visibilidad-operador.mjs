#!/usr/bin/env node
// Verificación por mutación del filtro de visibilidad del operador.
//
// Es la regresión concreta que R2 podía causar: al agregar `cargo_responsable_id`
// junto a `responsable_id`, mover la visibilidad al cargo habría dejado a los
// operadores con la pantalla vacía — sin error y sin aviso.
//
// Rompe el filtro a propósito, una mutación a la vez, y cuenta cuántas pruebas
// caen. Restaura el original SIEMPRE.

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const RIESGOS = 'src/lib/actions/riesgos.ts'
const PURO = 'src/lib/compliance/responsables.ts'
const PRUEBAS = 'src/lib/actions/riesgos-visibilidad.test.ts'

const MUTACIONES = [
  {
    nombre: '1. filtrar por cargo_responsable_id en vez de responsable_id',
    archivo: PURO,
    de: `export const COLUMNA_VISIBILIDAD_OPERADOR = 'responsable_id' as const;`,
    a: `export const COLUMNA_VISIBILIDAD_OPERADOR = 'cargo_responsable_id' as const;`,
  },
  {
    nombre: '2. quitar el filtro del listado (el operador ve todo)',
    archivo: RIESGOS,
    de: `    query = query.eq(COLUMNA_VISIBILIDAD_OPERADOR, userId)`,
    a: ``,
  },
  {
    nombre: '3. quitar el guard del detalle',
    archivo: RIESGOS,
    de: `    if (!operadorVeControl(control, userId)) return null`,
    a: ``,
  },
  {
    nombre: '4. el detalle mira el cargo en vez del usuario',
    archivo: PURO,
    de: `  return !!userId && control.responsable_id === userId;`,
    a: `  return !!userId && (control as { cargo_responsable_id?: string | null }).cargo_responsable_id != null;`,
  },
  {
    nombre: '5. dejar pasar la sesion sin userId en el listado',
    archivo: RIESGOS,
    de: `    if (!userId) return []
    query = query.eq(COLUMNA_VISIBILIDAD_OPERADOR, userId)`,
    a: `    query = query.eq(COLUMNA_VISIBILIDAD_OPERADOR, userId)`,
  },
  {
    nombre: '6. aplicar el filtro tambien a owner/admin',
    archivo: RIESGOS,
    de: `  if (!perms.canViewRiesgos && perms.canViewControlesAsignados) {
    if (!userId) return []
    query = query.eq(COLUMNA_VISIBILIDAD_OPERADOR, userId)`,
    a: `  if (true) {
    if (!userId) return []
    query = query.eq(COLUMNA_VISIBILIDAD_OPERADOR, userId)`,
  },
]

const originales = new Map([
  [RIESGOS, readFileSync(RIESGOS, 'utf8')],
  [PURO, readFileSync(PURO, 'utf8')],
])
const resultados = []

function fallidas() {
  try {
    execSync(`npx vitest run ${PRUEBAS} --reporter=json --outputFile=/tmp/mut-visibilidad.json`, {
      stdio: 'pipe',
    })
    return 0
  } catch {
    /* rojas: el conteo sale del JSON, no del código de salida */
  }
  try {
    const r = JSON.parse(readFileSync('/tmp/mut-visibilidad.json', 'utf8'))
    return r.numFailedTests ?? -1
  } catch {
    return -1
  }
}

function restaurar() {
  for (const [ruta, texto] of originales) writeFileSync(ruta, texto)
}

try {
  for (const m of MUTACIONES) {
    const original = originales.get(m.archivo)
    if (!original.includes(m.de)) {
      resultados.push({ ...m, caidas: 'NO APLICA (el texto no existe)' })
      continue
    }
    restaurar()
    writeFileSync(m.archivo, original.replace(m.de, m.a))
    resultados.push({ ...m, caidas: fallidas() })
  }
} finally {
  restaurar()
}

console.log('\n=== Verificación por mutación — visibilidad del operador ===\n')
let sobrevivientes = 0
for (const r of resultados) {
  const ok = typeof r.caidas === 'number' && r.caidas > 0
  if (!ok) sobrevivientes += 1
  console.log(`${ok ? '✓' : '✗ SOBREVIVE'}  ${r.nombre} → ${r.caidas} prueba(s) caída(s)`)
}
console.log(
  `\n${resultados.length - sobrevivientes}/${resultados.length} mutaciones detectadas.` +
    (sobrevivientes ? '  ⚠️ Hay mutaciones que NINGUNA prueba atrapa.' : ''),
)
process.exit(sobrevivientes ? 1 : 0)
