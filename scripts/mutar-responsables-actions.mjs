#!/usr/bin/env node
// Verificación por mutación del CABLEADO de R2 (server actions).
//
// Aquí lo que se prueba no es la regla sino el pegamento: que la foto salga de
// la base y no del cliente, y que el aislamiento por workspace —que el service
// client no aplica solo— esté puesto a mano en cada consulta.
//
// Si una mutación no tumba nada, el doble de la base está devolviendo lo mismo
// para cualquier consulta y las pruebas pasan por la razón equivocada.

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const OBJETIVO = 'src/lib/actions/compliance-responsables.ts'
const PRUEBAS = 'src/lib/actions/compliance-responsables.test.ts'

const MUTACIONES = [
  {
    nombre: '1. la foto toma el updated_at del CLIENTE en vez de la base',
    de: `      controles_snapshot: armarSnapshot(lista),`,
    a: `      controles_snapshot: armarSnapshot(lista.map((c) => ({ ...c, updated_at: '2099-01-01T00:00:00.000Z' }))),`,
  },
  {
    nombre: '2. la foto no filtra por cargo (se lleva todos los controles)',
    de: `    .eq('cargo_responsable_id', input.cargo_id)`,
    a: ``,
  },
  {
    nombre: '3. la lectura del cargo al aceptar no filtra por workspace',
    de: `  const { data: cargo, error: errCargo } = await svc
    .from('compliance_cargos')
    .select('id, nombre')
    .eq('id', input.cargo_id)
    .eq('workspace_id', guard.workspaceId)`,
    a: `  const { data: cargo, error: errCargo } = await svc
    .from('compliance_cargos')
    .select('id, nombre')
    .eq('id', input.cargo_id)`,
  },
  {
    nombre: '4. la foto de controles no filtra por workspace',
    de: `    .select('id, referencia, nombre_control, updated_at')
    .eq('workspace_id', guard.workspaceId)
    .eq('cargo_responsable_id', input.cargo_id)`,
    a: `    .select('id, referencia, nombre_control, updated_at')
    .eq('cargo_responsable_id', input.cargo_id)`,
  },
  {
    nombre: '5. se permite aceptar un cargo sin controles',
    de: `  if (lista.length === 0) {`,
    a: `  if (false) {`,
  },
  {
    nombre: '6. el prefijo del soporte no se comprueba',
    de: `  if (soportePath && !soportePath.startsWith(\`\${guard.workspaceId}/\`)) {`,
    a: `  if (false) {`,
  },
  {
    nombre: '7. nominar no comprueba que el cargo este activo',
    de: `    if (!cargo.activo) return { ok: false, error: 'cargo_inactivo' };`,
    a: ``,
  },
  {
    nombre: '8. nominar acepta un cargo de otro workspace',
    de: `      .from('compliance_cargos')
      .select('id, activo')
      .eq('id', cargoId)
      .eq('workspace_id', guard.workspaceId)`,
    a: `      .from('compliance_cargos')
      .select('id, activo')
      .eq('id', cargoId)`,
  },
  {
    nombre: '9. nominar acepta un usuario de otro workspace',
    de: `      .select('id')
      .eq('id', usuarioId)
      .eq('workspace_id', guard.workspaceId)`,
    a: `      .select('id')
      .eq('id', usuarioId)`,
  },
  {
    nombre: '10. el update del control no filtra por workspace',
    de: `    .update({ cargo_responsable_id: cargoId, responsable_id: usuarioId })
    .eq('id', input.control_id)
    .eq('workspace_id', guard.workspaceId)`,
    a: `    .update({ cargo_responsable_id: cargoId, responsable_id: usuarioId })
    .eq('id', input.control_id)`,
  },
  {
    nombre: '11. el tablero lee los controles de todos los workspaces',
    de: `      .select(COLUMNAS_CONTROL)
      .eq('workspace_id', guard.workspaceId)`,
    a: `      .select(COLUMNAS_CONTROL)`,
  },
  {
    nombre: '12. el selector de usuarios no filtra por workspace',
    de: `    .select('id, full_name')
    .eq('workspace_id', workspaceId)`,
    a: `    .select('id, full_name')`,
  },
  {
    nombre: '13. la deteccion de cargo duplicado se salta',
    de: `  if (choque) {`,
    a: `  if (false) {`,
  },
  {
    nombre: '14. cambiarEstadoCargo no filtra por workspace',
    de: `    .update({ activo: input.activo })
    .eq('id', input.cargo_id)
    .eq('workspace_id', guard.workspaceId)`,
    a: `    .update({ activo: input.activo })
    .eq('id', input.cargo_id)`,
  },
  {
    nombre: '15. el guard de rol se desactiva',
    de: `  if (!puedeGestionarResponsables(role)) {`,
    a: `  if (false) {`,
  },
  {
    nombre: '16. aceptada_por se llena con el oficial que registra',
    de: `      aceptada_por: input.medio === 'firma_one' ? guard.userId : null,`,
    a: `      aceptada_por: guard.userId,`,
  },
]

const original = readFileSync(OBJETIVO, 'utf8')
const resultados = []

function fallidas() {
  try {
    execSync(`npx vitest run ${PRUEBAS} --reporter=json --outputFile=/tmp/mut-resp-actions.json`, {
      stdio: 'pipe',
    })
    return 0
  } catch {
    /* rojas: el conteo sale del JSON, no del código de salida */
  }
  try {
    const r = JSON.parse(readFileSync('/tmp/mut-resp-actions.json', 'utf8'))
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
    writeFileSync(OBJETIVO, original.replace(m.de, m.a))
    resultados.push({ ...m, caidas: fallidas() })
  }
} finally {
  writeFileSync(OBJETIVO, original)
}

console.log('\n=== Verificación por mutación — compliance-responsables.ts ===\n')
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
