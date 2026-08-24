#!/usr/bin/env node
// Verificación por mutación de la regla de aceptación (R2).
//
// Rompe la regla a propósito, una mutación a la vez, y cuenta cuántas pruebas
// caen. Una mutación que NO tumba nada señala un hueco de cobertura real: la
// prueba que la debía atrapar está pasando por otra razón.
//
// Restaura el original SIEMPRE, incluso si algo revienta.

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const OBJETIVO = 'src/lib/compliance/responsables.ts'
const PRUEBAS = 'src/lib/compliance/responsables.test.ts'

const MUTACIONES = [
  {
    nombre: '1. ignorar updated_at (basta estar en la foto)',
    de: `  if (!control.updated_at || fotografiado.updated_at !== control.updated_at) {`,
    a: `  if (false) {`,
  },
  {
    nombre: '2. tomar la aceptacion MAS ANTIGUA del cargo',
    de: `    if (fila.created_at > mejor.created_at) return fila;`,
    a: `    if (fila.created_at < mejor.created_at) return fila;`,
  },
  {
    nombre: '3. sin_cargo tratado como cubierto',
    de: `    return { cubierto: false, motivo: 'sin_cargo', aceptacion: null, updated_at_aceptado: null };`,
    a: `    return { cubierto: true, motivo: 'sin_cargo', aceptacion: null, updated_at_aceptado: null };`,
  },
  {
    nombre: '4. no_incluido devuelto como cubierto',
    de: `      cubierto: false,
      motivo: 'no_incluido',`,
    a: `      cubierto: true,
      motivo: 'no_incluido',`,
  },
  {
    nombre: '5. no filtrar por cargo_id (cualquier aceptacion sirve)',
    de: `  const delCargo = aceptacionesDelCargo.filter((a) => a.cargo_id === control.cargo_responsable_id);`,
    a: `  const delCargo = aceptacionesDelCargo.slice();`,
  },
  {
    nombre: '6. updated_at nulo del control tratado como coincidencia',
    de: `  if (!control.updated_at || fotografiado.updated_at !== control.updated_at) {`,
    a: `  if (control.updated_at && fotografiado.updated_at !== control.updated_at) {`,
  },
  {
    nombre: '7. porcentajes en 0 en vez de null sin controles',
    de: `    pct_nominados: total === 0 ? null : redondear((conCargo / total) * 100),`,
    a: `    pct_nominados: total === 0 ? 0 : redondear((conCargo / total) * 100),`,
  },
  {
    nombre: '7b. pct_aceptacion_vigente en 0 en vez de null',
    de: `    pct_aceptacion_vigente: total === 0 ? null : redondear((vigentes / total) * 100),`,
    a: `    pct_aceptacion_vigente: total === 0 ? 0 : redondear((vigentes / total) * 100),`,
  },
  {
    nombre: '8. operadorVeControl mirando el CARGO en vez del usuario',
    de: `  return !!userId && control.responsable_id === userId;`,
    a: `  return !!userId && (control as { cargo_responsable_id?: string | null }).cargo_responsable_id != null;`,
  },
  {
    nombre: '9. operadorVeControl sin guard de userId',
    de: `  return !!userId && control.responsable_id === userId;`,
    a: `  return control.responsable_id === userId;`,
  },
  {
    nombre: '10. desempate de created_at por orden del arreglo',
    de: `    if (fila.created_at === mejor.created_at && fila.id > mejor.id) return fila;`,
    a: `    if (fila.created_at === mejor.created_at) return mejor;`,
  },
  {
    nombre: '11. firma_one aceptada aunque el interruptor este apagado',
    de: `  if (input.medio === 'firma_one' && !FIRMA_ONE_HABILITADA) {`,
    a: `  if (false) {`,
  },
  {
    nombre: '12. soporte opcional en documento_cargado',
    de: `  if (input.medio === 'documento_cargado' && !input.soporte_path?.trim()) {`,
    a: `  if (false) {`,
  },
  {
    nombre: '13. fecha futura permitida',
    de: `    if (fecha > hoyISO) {`,
    a: `    if (false) {`,
  },
  {
    nombre: '14. armarSnapshot descarta updated_at',
    de: `    updated_at: c.updated_at ?? '',`,
    a: `    updated_at: '',`,
  },
]

const original = readFileSync(OBJETIVO, 'utf8')
const resultados = []

function fallidas() {
  try {
    execSync(`npx vitest run ${PRUEBAS} --reporter=json --outputFile=/tmp/mut-responsables.json`, {
      stdio: 'pipe',
    })
    return 0
  } catch {
    // Salida distinta de 0 = hubo rojas. El conteo sale del JSON, no del código.
  }
  try {
    const r = JSON.parse(readFileSync('/tmp/mut-responsables.json', 'utf8'))
    return r.numFailedTests ?? -1
  } catch {
    return -1
  }
}

try {
  for (const m of MUTACIONES) {
    if (!original.includes(m.de)) {
      resultados.push({ ...m, caidas: 'NO APLICA (el texto no existe)' })
      continue
    }
    const veces = original.split(m.de).length - 1
    writeFileSync(OBJETIVO, original.replace(m.de, m.a))
    resultados.push({ ...m, veces, caidas: fallidas() })
  }
} finally {
  writeFileSync(OBJETIVO, original)
}

console.log('\n=== Verificación por mutación — responsables.ts ===\n')
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
