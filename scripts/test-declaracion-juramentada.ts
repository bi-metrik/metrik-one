/**
 * Genera Declaraciones Juramentadas de PRUEBA (formato corto, NIT con DV) con
 * datos hardcoded para validar el render sin tocar la DB ni la app. No es código
 * de producto. Corre 3 escenarios de NIT+DV y verifica el texto renderizado.
 *
 * Uso:  npx tsx scripts/test-declaracion-juramentada.ts
 * Artefactos: /tmp/test-declaracion-*.pdf
 */
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { execFileSync } from 'node:child_process'
import fs from 'fs'
import DeclaracionJuramentadaPDF from '../src/lib/pdf/declaracion-juramentada-pdf'
import { calcularDvNit } from '../src/lib/dian/nit'

type Escenario = {
  nombre: string
  numero_identificacion: string | null
  dv: string | null
  esperaNit: string // lo que debe aparecer tras "NIT No." y "NIT:"
}

// Nota sobre el DV calculado: el algoritmo DIAN módulo 11 (calcularDvNit) da
// DV=0 para 16929059 y DV=8 para 16640498 (consistente con qa-010-deisy). Por eso
// el DV del RUT MANDA cuando existe: para Echeverri (V0006) el RUT trae dv=1, así
// que el documento imprime 16929059-1 aunque el cálculo dé 0. El fallback (sin dv)
// usa el cálculo → 16929059-0.
const ESCENARIOS: Escenario[] = [
  { nombre: 'Con DV del RUT (manda sobre el cálculo)', numero_identificacion: '16929059', dv: '1', esperaNit: '16929059-1' },
  { nombre: 'Caso pegado corregido (base limpia + dv del RUT)', numero_identificacion: '16640498', dv: '8', esperaNit: '16640498-8' },
  { nombre: 'Fallback sin dv (se calcula: DIAN módulo 11 → 0)', numero_identificacion: '16929059', dv: null, esperaNit: '16929059-0' },
]

function pdfText(pdfPath: string): string {
  const txt = pdfPath.replace(/\.pdf$/, '.txt')
  execFileSync('pdftotext', [pdfPath, txt])
  return fs.readFileSync(txt, 'utf8')
}

async function main() {
  // Sanity: DIAN módulo 11 — calcularDvNit('16929059') === '0', ('16640498') === '8'
  const dvA = calcularDvNit('16929059')
  const dvB = calcularDvNit('16640498')
  console.log(`calcularDvNit('16929059') = ${dvA} ${dvA === '0' ? '✓' : '✗ (esperaba 0)'}`)
  console.log(`calcularDvNit('16640498') = ${dvB} ${dvB === '8' ? '✓' : '✗ (esperaba 8)'}`)

  let fails = 0
  for (const [i, e] of ESCENARIOS.entries()) {
    const element = createElement(DeclaracionJuramentadaPDF, {
      datos: {
        nombre_solicitante: 'OSCAR RAMIREZ GOMEZ',
        numero_identificacion: e.numero_identificacion,
        dv: e.dv,
        tipo_vehiculo: 'Tesla Model 3', // ya no se usa; retrocompat del caller
        email: 'oscar.ramirez@correo.com',
        telefono: '+57 3001234567',
        municipio: 'Tuluá',
      },
      fechaGeneracion: '2026-07-14',
      codigoNegocio: `TEST-${i + 1}`,
    })
    const buffer = await renderToBuffer(element)
    const out = `/tmp/test-declaracion-${i + 1}.pdf`
    fs.writeFileSync(out, buffer)
    const txt = pdfText(out)
    const okIntro = txt.includes(`NIT No. ${e.esperaNit}`)
    const okFirma = txt.includes(`NIT: ${e.esperaNit}`)
    const ok = okIntro && okFirma
    if (!ok) fails++
    console.log(`\n[${ok ? 'PASS' : 'FAIL'}] Escenario ${i + 1}: ${e.nombre}`)
    console.log(`   numero_identificacion=${e.numero_identificacion} dv=${e.dv} → espera "${e.esperaNit}"`)
    console.log(`   intro "NIT No. ${e.esperaNit}": ${okIntro ? '✓' : '✗'} | firma "NIT: ${e.esperaNit}": ${okFirma ? '✓' : '✗'}`)
    console.log(`   ${out}`)
  }
  console.log(`\n=== ${fails === 0 ? 'TODO PASS ✅' : `${fails} FALLAS ❌`} ===`)
  process.exit(fails === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
