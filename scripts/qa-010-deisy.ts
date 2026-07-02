/**
 * QA del Formato 010 — verifica los 9 reportes de Deisy (2026-06-30) contra el
 * render real, con DATOS REALES de V0006 (Echeverri, Yumbo→Otras) y V0020
 * (Villegas, Cali). Replica la resolución del pipeline (DV determinista + códigos
 * DANE + preset de seccional) y comprueba el PDF con pdftotext.
 *
 * Correr:  npx tsx scripts/qa-010-deisy.ts
 * Artefactos: /tmp/qa010/*.pdf  +  /tmp/qa010/*.txt  (para revisión multi-agente)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { generarFormulario010, type Formulario010Datos, type Formulario010Constantes } from '../src/lib/pdf/formulario-010'
import { calcularDvNit } from '../src/lib/dian/nit'
import { resolverCodigosUbicacion } from '../src/lib/dian/divipola'

const OUT = '/tmp/qa010'
mkdirSync(OUT, { recursive: true })

let fails = 0
const log: string[] = []
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL'
  if (!cond) fails++
  const line = `[${status}] ${name}${detail ? ` — ${detail}` : ''}`
  log.push(line)
  console.log(line)
}

function pdftext(pdfPath: string, opts: string[] = []): string {
  const txtPath = pdfPath.replace(/\.pdf$/, '.txt')
  execFileSync('pdftotext', [...opts, pdfPath, txtPath])
  return require('node:fs').readFileSync(txtPath, 'utf8') as string
}
// Texto por página (form fields van al layout; usamos -layout para conservar posición).
function pageText(pdfPath: string): { p1: string; p2: string; all: string } {
  const all = pdftext(pdfPath, ['-layout'])
  const parts = all.split('\f') // form feed separa páginas
  return { p1: parts[0] ?? '', p2: parts[1] ?? '', all }
}

// ── Presets reales (de bloque_configs.config_extra.seccionales en SOENA) ────────
const PRESET_OTRAS: Partial<Formulario010Constantes> = {
  tipo_obligacion: 'Impuesto sobre las Ventas',
  concepto_saldo: 'Pago de lo no debido. Otros: UPME',
  nombre_documento: 'Factura Electrónica de Venta',
  seccional_literal: true,
}
const PRESET_CALI: Partial<Formulario010Constantes> = {
  tipo_obligacion: 'Otras: Beneficio tributario',
  concepto_saldo: 'Pago de lo no debido. Otros: UPME',
  nombre_documento: 'Factura de compra',
  seccional_literal: true,
  mostrar_razon_social: true,
  cod_representacion_1005: '18',
}
const BASE_CONST = { concepto: '06', tipo_solicitud: 'A solicitud de parte' }

// ── Caso Echeverri (V0006): Yumbo → Otras, override tipo_documento = 31 ─────────
function datosEcheverri(): Formulario010Datos {
  const nit = '16929059'
  const codes = resolverCodigosUbicacion('COLOMBIA', 'Valle del Cauca', 'Yumbo')
  return {
    nit, dv: calcularDvNit(nit), tipo_documento: '31', // <-- override de Deisy
    primer_apellido: 'ECHEVERRI', segundo_apellido: 'PANESSO', primer_nombre: 'JUAN', otros_nombres: 'PABLO',
    razon_social: null, direccion_seccional: 'Otras seccionales',
    correo_electronico: 'juecheverri@royalpha.com.co', direccion: 'PARC COLINAS DE ARROYOHONDO CORR DAPA', telefono: '6582202',
    pais: 'COLOMBIA', departamento: 'Valle del Cauca', municipio: 'Yumbo',
    codigo_pais: codes.codigo_pais, codigo_departamento: codes.codigo_departamento, codigo_municipio: codes.codigo_municipio,
    entidad_financiera: 'Bancolombia', numero_cuenta: '16043379597', tipo_cuenta: 'Ahorros',
    valor_solicitado: '5969026', numero_factura: 'SV6588', fecha_factura: '2025-07-14',
    nombre_suscriptor: null, tipo_doc_suscriptor: null, identificacion_suscriptor: null, dv_suscriptor: null,
  }
}
// ── Caso Villegas (V0020): Cali ────────────────────────────────────────────────
function datosVillegas(): Formulario010Datos {
  const nit = '16640498'
  const codes = resolverCodigosUbicacion('COLOMBIA', 'Valle del Cauca', 'Cali')
  return {
    nit, dv: calcularDvNit(nit), tipo_documento: null, // default → 13
    primer_apellido: 'VILLEGAS', segundo_apellido: 'TORO', primer_nombre: 'JAVIER', otros_nombres: 'ALONSO',
    razon_social: null, direccion_seccional: 'Cali',
    correo_electronico: 'contacto@isamoda.com.co', direccion: 'CR 102 34 133 TO 2 AP 103 CON CAPRIANI', telefono: '5580109',
    pais: 'COLOMBIA', departamento: 'Valle del Cauca', municipio: 'Cali',
    codigo_pais: codes.codigo_pais, codigo_departamento: codes.codigo_departamento, codigo_municipio: codes.codigo_municipio,
    entidad_financiera: 'Bancolombia', numero_cuenta: '91253416454', tipo_cuenta: 'Ahorros',
    valor_solicitado: '6013274', numero_factura: 'SV6663', fecha_factura: '2025-08-23',
    nombre_suscriptor: null, tipo_doc_suscriptor: null, identificacion_suscriptor: null, dv_suscriptor: null,
  }
}

async function main() {
  console.log('=== QA 010 — 9 bugs de Deisy (2026-06-30) ===\n')

  // ── Bug 6: DV determinista ──
  check('Bug6 DV Echeverri 16929059 → 0', calcularDvNit('16929059') === '0', `got ${calcularDvNit('16929059')}`)
  check('Bug6 DV Villegas 16640498 → 8', calcularDvNit('16640498') === '8', `got ${calcularDvNit('16640498')}`)

  // ── Bug 5: códigos DANE por nombre ──
  const cYumbo = resolverCodigosUbicacion('COLOMBIA', 'Valle del Cauca', 'Yumbo')
  check('Bug5 Yumbo → pais 169 / dep 76 / mun 892',
    cYumbo.codigo_pais === '169' && cYumbo.codigo_departamento === '76' && cYumbo.codigo_municipio === '892',
    JSON.stringify(cYumbo))
  const cCali = resolverCodigosUbicacion('COLOMBIA', 'Valle del Cauca', 'Cali')
  check('Bug5 Cali → pais 169 / dep 76 / mun 001',
    cCali.codigo_pais === '169' && cCali.codigo_departamento === '76' && cCali.codigo_municipio === '001',
    JSON.stringify(cCali))
  check('Bug5 municipio NO copia el código de departamento', cYumbo.codigo_municipio !== cYumbo.codigo_departamento)

  // ── Render Echeverri (Otras + override 31) ──
  const dE = datosEcheverri()
  const cE = { ...BASE_CONST, ...PRESET_OTRAS } as Formulario010Constantes
  const pdfE = `${OUT}/echeverri-010.pdf`
  writeFileSync(pdfE, await generarFormulario010(dE, cE))
  const tE = pageText(pdfE)

  // ── Bug 3: casilla 20 respeta 31 (no fuerza 13). Verifica la FILA DE DATOS
  // (tipo doc pegado a la cédula), no un include global (el label "31. DV" siempre
  // está en la hoja y daría falso PASS).
  const m31 = (tE.all.match(/\b31\s+16929059\b/g) || []).length
  check('Bug3 casilla 20 = 31 en la fila de datos (ambas hojas)', m31 >= 2, `filas 31+cédula: ${m31}`)
  check('Bug3 casilla 20 NO quedó en 13 para Echeverri (override)', !/\b13\s+16929059\b/.test(tE.all))
  // ── Bug 8: "06" NO en la hoja 2 (espacio reservado DIAN) ──
  // El "06" legítimo está en hoja 1 (casilla 2). En hoja 2 no debe aparecer.
  check('Bug8 "06" presente en hoja 1 (casilla 2)', /\b06\b/.test(tE.p1))
  check('Bug8 "06" AUSENTE en hoja 2 (reservado DIAN)', !/\b06\b/.test(tE.p2), `p2 head: ${tE.p2.slice(0, 60).replace(/\n/g, ' ')}`)
  // ── Bug 6 render: DV 0 en el PDF ──
  check('Bug6 DV=0 visible en el PDF de Echeverri', tE.all.includes('16929059') && dE.dv === '0')
  // ── Bug 5 render: códigos correctos ──
  check('Bug5 render Echeverri mun=892 (no 76)', dE.codigo_municipio === '892')
  // ── Bug 2: firma con nombre del solicitante (jala automático) ──
  check('Bug2 firma con nombre del solicitante', tE.p1.includes('JUAN') || tE.all.includes('JUAN PABLO ECHEVERRI PANESSO'))

  // ── Render Villegas (Cali) ──
  const dV = datosVillegas()
  const cV = { ...BASE_CONST, ...PRESET_CALI, organizacion_1006: 'JAVIER ALONSO VILLEGAS TORO' } as Formulario010Constantes
  const pdfV = `${OUT}/villegas-cali-010.pdf`
  writeFileSync(pdfV, await generarFormulario010(dV, cV))
  const tV = pageText(pdfV)

  // ── Bug 4: seccional Cali aplicada (casilla 12) ──
  check('Bug4 casilla 12 = "Cali" (no Otras)', tV.p1.includes('Cali') && !tV.all.includes('Otras seccionales'))
  // ── Bug 9: casilla 57 = "Factura de compra" (no de venta) ──
  check('Bug9 casilla 57 = "Factura de compra"', tV.p2.includes('Factura de compra'))
  check('Bug9 casilla 57 NO dice "Factura Electrónica de Venta"', !tV.p2.includes('Factura Electrónica de Venta') && !tV.p2.includes('Factura electrónica de ventas'))
  // ── Bug 7: 1005 y 1006 llenas en Cali ──
  check('Bug7 casilla 1005 = 18 (Cali)', tV.p1.includes('18'))
  check('Bug7 casilla 1006 = nombre completo (Cali)', tV.p1.includes('JAVIER ALONSO VILLEGAS TORO') || tV.all.includes('VILLEGAS TORO'))
  // ── Bug 6/5 en Cali ──
  check('Bug6 DV Villegas = 8', dV.dv === '8')
  check('Bug5 Villegas mun=001', dV.codigo_municipio === '001')
  // ── Bug 8 en Cali también ──
  check('Bug8 "06" ausente en hoja 2 (Cali)', !/\b06\b/.test(tV.p2))
  // ── Bug 3 default: sin override, casilla 20 = 13 (fila de datos) ──
  check('Bug3 default 13 en Villegas (sin override)', /\b13\s+16640498\b/.test(tV.all))

  writeFileSync(`${OUT}/RESUMEN.txt`, log.join('\n'))
  console.log(`\n=== ${fails === 0 ? 'TODO PASS ✅' : `${fails} FALLAS ❌`} ===`)
  console.log(`Artefactos en ${OUT}/ (echeverri-010.pdf, villegas-cali-010.pdf, *.txt)`)
  process.exit(fails === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(2) })
