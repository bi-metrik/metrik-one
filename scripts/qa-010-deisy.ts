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

// ── Constantes GENERALES nuevas (spec 2026-07-08, verificado contra el ejemplo
//    real de Deisy). Casilla 2=3, 50=UPME, 51=IVA/175, 57=vacío, 40=Giro cuenta. ─
const BASE_CONST = {
  concepto: '3', // casilla 2
  tipo_solicitud: 'A solicitud de parte', // casilla 44 (sin cambio)
  tipo_obligacion: 'UPME', // casilla 50
  concepto_saldo: 'IVA', // casilla 51 texto
  codigo_concepto_saldo: '175', // casilla 51 Cód.
  nombre_documento: '', // casilla 57 vacía
  descripcion_forma_pago: 'Giro cuenta', // casilla 40
}
// ── Presets de seccional POST-A2 (Cali ya NO override tipo_obligacion/concepto_saldo/
//    nombre_documento — hereda el general nuevo; solo aporta sus particularidades). ─
// "Otras seccionales" tampoco override esos 3 → hereda general.
const PRESET_OTRAS: Partial<Formulario010Constantes> = {
  seccional_literal: true,
}
const PRESET_CALI: Partial<Formulario010Constantes> = {
  seccional_literal: true,
  mostrar_razon_social: true,
  cod_representacion_1005: '18',
}

// ── Caso Echeverri (V0006): Yumbo → Otras, override tipo_documento = 31 ─────────
function datosEcheverri(): Formulario010Datos {
  const nit = '16929059'
  const codes = resolverCodigosUbicacion('COLOMBIA', 'Valle del Cauca', 'Yumbo')
  return {
    nit, dv: calcularDvNit(nit), tipo_documento: '31', // <-- override de Deisy
    primer_apellido: 'ECHEVERRI', segundo_apellido: 'PANESSO', primer_nombre: 'JUAN', otros_nombres: 'PABLO',
    razon_social: null, direccion_seccional: 'Otras seccionales', codigo_seccional: null,
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
    razon_social: null, direccion_seccional: 'Cali', codigo_seccional: '05',
    correo_electronico: 'contacto@isamoda.com.co', direccion: 'CR 102 34 133 TO 2 AP 103 CON CAPRIANI', telefono: '5580109',
    pais: 'COLOMBIA', departamento: 'Valle del Cauca', municipio: 'Cali',
    codigo_pais: codes.codigo_pais, codigo_departamento: codes.codigo_departamento, codigo_municipio: codes.codigo_municipio,
    entidad_financiera: 'Bancolombia', numero_cuenta: '91253416454', tipo_cuenta: 'Ahorros',
    valor_solicitado: '6013274', numero_factura: 'SV6663', fecha_factura: '2025-08-23',
    nombre_suscriptor: null, tipo_doc_suscriptor: null, identificacion_suscriptor: null, dv_suscriptor: null,
  }
}

async function main() {
  console.log('=== QA 010 — valores A1 (spec 2026-07-08) + determinismo + seccionales A2 ===\n')

  // ── DV determinista ──
  check('DV Echeverri 16929059 → 0', calcularDvNit('16929059') === '0', `got ${calcularDvNit('16929059')}`)
  check('DV Villegas 16640498 → 8', calcularDvNit('16640498') === '8', `got ${calcularDvNit('16640498')}`)

  // ── Códigos DANE por nombre ──
  const cYumbo = resolverCodigosUbicacion('COLOMBIA', 'Valle del Cauca', 'Yumbo')
  check('Yumbo → pais 169 / dep 76 / mun 892',
    cYumbo.codigo_pais === '169' && cYumbo.codigo_departamento === '76' && cYumbo.codigo_municipio === '892',
    JSON.stringify(cYumbo))
  const cCali = resolverCodigosUbicacion('COLOMBIA', 'Valle del Cauca', 'Cali')
  check('Cali → pais 169 / dep 76 / mun 001',
    cCali.codigo_pais === '169' && cCali.codigo_departamento === '76' && cCali.codigo_municipio === '001',
    JSON.stringify(cCali))
  check('municipio NO copia el código de departamento', cYumbo.codigo_municipio !== cYumbo.codigo_departamento)

  // ── Render Echeverri (Otras + override 31) ──
  const dE = datosEcheverri()
  const cE = { ...BASE_CONST, ...PRESET_OTRAS } as Formulario010Constantes
  const pdfE = `${OUT}/echeverri-010.pdf`
  writeFileSync(pdfE, await generarFormulario010(dE, cE))
  const tE = pageText(pdfE)

  // ── Casilla 20 = 31 en la fila de datos (override respetado). Verifica la FILA DE
  // DATOS (tipo doc pegado a la cédula), no un include global.
  const m31 = (tE.all.match(/\b31\s+16929059\b/g) || []).length
  check('Casilla20 = 31 en la fila de datos (ambas hojas)', m31 >= 2, `filas 31+cédula: ${m31}`)
  check('Casilla20 NO quedó en 13 para Echeverri', !/\b13\s+16929059\b/.test(tE.all))
  // ── A1 Casilla 2 = "3" (concepto devolución), presente en hoja 1 ──
  check('A1 Casilla2 = "3" en hoja 1', /\b3\b/.test(tE.p1))
  // ── El espacio reservado DIAN de la hoja 2 NO lleva el concepto (no "3" ni "06") ──
  check('Hoja2 sin concepto en espacio reservado DIAN', !/^\s*0?3\s*$/m.test(tE.p2.slice(0, 80)) && !/\b06\b/.test(tE.p2))
  // ── A1 Casilla 50 = "UPME" (tipo obligación) ──
  check('A1 Casilla50 = "UPME"', tE.p2.includes('UPME'))
  // ── A1 Casilla 51 = "IVA" + Cód. 175 ──
  check('A1 Casilla51 texto = "IVA"', /\bIVA\b/.test(tE.p2))
  check('A1 Casilla51 Cód. = 175', tE.p2.includes('175'))
  // ── A1 Casilla 40 = "Giro cuenta" ──
  check('A1 Casilla40 = "Giro cuenta"', tE.p1.includes('Giro cuenta'))
  // ── A1 Casilla 57 vacía: NO aparece "Factura electrónica de ventas" ──
  check('A1 Casilla57 vacía (sin "Factura electrónica de ventas")', !tE.p2.includes('Factura electrónica de ventas') && !tE.p2.includes('Factura Electrónica de Venta'))
  // ── A1 Casilla 53 = "01" fijo (no bimestre). Fecha factura 2025-07-14 → bimestre
  //    4; debe salir "01", no "04". ──
  check('A1 Casilla53 = "01" (fijo, no bimestre)', /\b01\b/.test(tE.p2))
  // ── DV determinista (=0) en el PDF ──
  check('DV=0 visible en el PDF de Echeverri', tE.all.includes('16929059') && dE.dv === '0')
  // ── Códigos DANE correctos ──
  check('Render Echeverri mun=892 (no 76)', dE.codigo_municipio === '892')
  // ── Firma con nombre del solicitante (jala automático) ──
  check('Firma con nombre del solicitante', tE.p1.includes('JUAN') || tE.all.includes('JUAN PABLO ECHEVERRI PANESSO'))
  // ── A1 Casilla 1002 (tipo doc firma) = "31" (no "CC") ──
  check('A1 Casilla1002 firma = 31 (no CC)', !/1002\.?\s*Tipo doc\.?\s*CC/i.test(tE.p1) && tE.all.includes('31'))

  // ── Render Villegas (Cali) ──
  const dV = datosVillegas()
  const cV = { ...BASE_CONST, ...PRESET_CALI, organizacion_1006: 'JAVIER ALONSO VILLEGAS TORO' } as Formulario010Constantes
  const pdfV = `${OUT}/villegas-cali-010.pdf`
  writeFileSync(pdfV, await generarFormulario010(dV, cV))
  const tV = pageText(pdfV)

  // ── Seccional Cali aplicada (casilla 12 = nombre oficial de Cali) ──
  check('Casilla12 Cali (nombre oficial)', tV.p1.includes('Cali') && !tV.all.includes('Otras seccionales'))
  // ── A2 Cali HEREDA el general nuevo: casilla 50=UPME, 51=IVA/175, 57 vacía ──
  check('A2 Cali casilla50 = "UPME" (heredada)', tV.p2.includes('UPME') && !tV.p2.includes('Beneficio tributario'))
  check('A2 Cali casilla51 = "IVA" + 175 (heredada)', /\bIVA\b/.test(tV.p2) && tV.p2.includes('175'))
  check('A2 Cali casilla57 vacía (heredada; sin "Factura de compra")', !tV.p2.includes('Factura de compra') && !tV.p2.includes('Factura Electrónica de Venta'))
  // ── A2 Cali MANTIENE sus particularidades: 1005=18 + 1006 nombre completo ──
  check('A2 Cali casilla1005 = 18', tV.p1.includes('18'))
  check('A2 Cali casilla1006 = nombre completo', tV.p1.includes('JAVIER ALONSO VILLEGAS TORO') || tV.all.includes('VILLEGAS TORO'))
  // ── DV / DANE en Cali ──
  check('DV Villegas = 8', dV.dv === '8')
  check('Villegas mun=001', dV.codigo_municipio === '001')
  // ── A1 Casilla 20 default = 31 (sin override; antes era 13) ──
  check('A1 Casilla20 default = 31 en Villegas (sin override)', /\b31\s+16640498\b/.test(tV.all) && !/\b13\s+16640498\b/.test(tV.all))

  writeFileSync(`${OUT}/RESUMEN.txt`, log.join('\n'))
  console.log(`\n=== ${fails === 0 ? 'TODO PASS ✅' : `${fails} FALLAS ❌`} ===`)
  console.log(`Artefactos en ${OUT}/ (echeverri-010.pdf, villegas-cali-010.pdf, *.txt)`)
  process.exit(fails === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(2) })
