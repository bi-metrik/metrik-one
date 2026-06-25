/**
 * DRY-RUN cargue Devolución de IVA — caso piloto (sin escribir DB ni Drive).
 *
 * Extrae los documentos fuente (RUT, Factura, Certificado bancario, Concepto UPME)
 * con la MISMA extracción que ONE (src/lib/ai/extract-fields.ts, gemini-2.5-flash)
 * y resuelve las casillas del Formulario 010 vía campos_fuente. Imprime el resultado
 * para validar contra el ground truth (007_Formulario_010 ya generado a mano).
 *
 * Uso: npx tsx scripts/cargue-iva-dryrun.ts <carpeta-con-docs>
 *   docs esperados en la carpeta: 004_Rut.pdf, 005_Factura_*.pdf,
 *   006_certificado_bancario.pdf, 001_Certificado_Vehiculos_Electricos.pdf
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { extractFieldsFromDocument, type CampoExtraccion } from '../src/lib/ai/extract-fields'

// ── API key (lee .env.local sin dotenv) ──────────────────────────────────────
function loadGeminiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  try {
    const env = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    const m = env.match(/^GEMINI_API_KEY=(.*)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* noop */ }
  return ''
}

// ── campos_extraccion reales de los bloques fuente (copiados de DB) ───────────
const RUT: CampoExtraccion[] = [
  { slug: 'nit', label: 'NIT', tipo: 'texto', required: true, descripcion_ai: 'Número de Identificación Tributaria SIN dígito de verificación (casilla 5). Solo dígitos, sin puntos ni guiones.' },
  { slug: 'dv', label: 'DV', tipo: 'texto', required: true, descripcion_ai: 'Dígito de verificación del NIT (casilla 6). Un solo dígito numérico.' },
  { slug: 'razon_social', label: 'Razón social', tipo: 'texto', required: true, descripcion_ai: 'Razón social completa o nombres y apellidos del contribuyente (casillas 31 a 35 del RUT). Si es persona natural, concatenar primer apellido, segundo apellido, primer nombre y otros nombres.' },
  { slug: 'numero_identificacion', label: 'No. identificación', tipo: 'texto', required: true, descripcion_ai: 'Número de identificación / cédula del titular tal como aparece en el RUT, COMPLETO. Solo dígitos, sin puntos, comas, guiones ni espacios. Suele tener entre 7 y 10 dígitos. NO truncar ni omitir el último dígito.' },
  { slug: 'direccion_seccional', label: 'Dirección seccional', tipo: 'texto', required: true, descripcion_ai: 'Nombre de la dirección seccional DIAN (renglón 12 del RUT).' },
  { slug: 'direccion', label: 'Dirección', tipo: 'texto', required: true, descripcion_ai: 'Dirección de notificación (renglón 41 del RUT)' },
  { slug: 'telefono', label: 'Teléfono', tipo: 'texto', required: true, descripcion_ai: 'Número de teléfono (renglón 44 del RUT)' },
  { slug: 'email', label: 'Email', tipo: 'texto', required: true, descripcion_ai: 'Correo electrónico registrado (renglón 42 del RUT)' },
  { slug: 'municipio', label: 'Municipio', tipo: 'texto', required: false, descripcion_ai: 'Municipio o ciudad del domicilio fiscal registrado en el RUT' },
  { slug: 'departamento', label: 'Departamento', tipo: 'texto', required: false, descripcion_ai: 'Departamento del domicilio fiscal registrado en el RUT' },
  { slug: 'pais', label: 'País', tipo: 'texto', required: false, descripcion_ai: 'País del domicilio fiscal registrado en el RUT' },
  { slug: 'primer_apellido', label: 'Primer apellido', tipo: 'texto', required: false, descripcion_ai: 'Primer apellido del titular, casilla 31 del RUT. Solo el primer apellido. Vacío si es persona jurídica.' },
  { slug: 'segundo_apellido', label: 'Segundo apellido', tipo: 'texto', required: false, descripcion_ai: 'Segundo apellido del titular, casilla 32 del RUT. Vacío si no tiene o si es persona jurídica.' },
  { slug: 'primer_nombre', label: 'Primer nombre', tipo: 'texto', required: false, descripcion_ai: 'Primer nombre del titular, casilla 33 del RUT. Vacío si es persona jurídica.' },
  { slug: 'otros_nombres', label: 'Otros nombres', tipo: 'texto', required: false, descripcion_ai: 'Otros nombres del titular, casilla 34 del RUT. Vacío si no tiene o si es persona jurídica.' },
  { slug: 'codigo_pais', label: 'Código país', tipo: 'texto', required: false, descripcion_ai: 'Código numérico del país del domicilio en el RUT (casilla 26, sub-casilla Cód.). Para Colombia suele ser 169.' },
  { slug: 'codigo_departamento', label: 'Código departamento', tipo: 'texto', required: false, descripcion_ai: 'Código numérico del departamento del domicilio en el RUT (casilla 27, sub-casilla Cód.).' },
  { slug: 'codigo_municipio', label: 'Código municipio', tipo: 'texto', required: false, descripcion_ai: 'Código numérico del municipio/ciudad del domicilio en el RUT (casilla 28, sub-casilla Cód., DIVIPOLA).' },
]
const FACTURA: CampoExtraccion[] = [
  { slug: 'marca', label: 'Marca', tipo: 'texto', required: true, descripcion_ai: 'Marca o fabricante del vehículo (ej: BYD, Renault, Chevrolet, BMW)' },
  { slug: 'linea', label: 'Línea', tipo: 'texto', required: true, descripcion_ai: 'Modelo o línea del vehículo (ej: Dolphin, Kwid E-Tech, Onix)' },
  { slug: 'valor_unitario_sin_iva', label: 'Valor unitario sin IVA', tipo: 'currency', required: true, descripcion_ai: 'Valor unitario del vehículo SIN IVA en pesos colombianos. Buscar el subtotal o valor antes de impuestos. Solo números sin puntos ni comas.' },
  { slug: 'proveedor', label: 'Proveedor', tipo: 'texto', required: true, descripcion_ai: 'Razón social del emisor de la factura (quien vende el vehículo). Es el vendedor, no el comprador.' },
  { slug: 'numero_factura', label: 'No. Factura', tipo: 'texto', required: false, descripcion_ai: 'Número consecutivo de la factura electrónica de venta. Buscar en el encabezado del documento.' },
  { slug: 'fecha_factura', label: 'Fecha factura', tipo: 'fecha', required: false, descripcion_ai: 'Fecha de emisión de la factura en formato YYYY-MM-DD' },
  { slug: 'valor_iva', label: 'Valor IVA', tipo: 'currency', required: false, descripcion_ai: 'Valor total del IVA cobrado en la factura, en pesos colombianos. Solo números sin puntos ni comas.' },
  { slug: 'nit_proveedor', label: 'NIT proveedor', tipo: 'texto', required: false, descripcion_ai: 'NIT o número de identificación del emisor/vendedor de la factura, solo dígitos sin puntos ni guiones' },
]
const CERT: CampoExtraccion[] = [
  { slug: 'entidad_financiera', label: 'Entidad financiera', tipo: 'texto', required: true, descripcion_ai: 'Nombre del banco o entidad financiera que emite el certificado. Ejemplo: Bancolombia, Davivienda, BBVA.' },
  { slug: 'numero_cuenta', label: 'Número de cuenta', tipo: 'texto', required: true, descripcion_ai: 'Número de cuenta bancaria, solo dígitos sin guiones ni espacios.' },
  { slug: 'tipo_cuenta', label: 'Tipo de cuenta', tipo: 'texto', required: true, descripcion_ai: 'Tipo de cuenta: Ahorros o Corriente. Buscar si dice cuenta de ahorros o cuenta corriente.' },
]

// 010 casilla -> (bloque fuente, campo extraído) — del campos_fuente de formulario_dian
const MAPA_010: Array<[string, 'rut' | 'factura' | 'cert', string]> = [
  ['nit', 'rut', 'numero_identificacion'], ['dv', 'rut', 'dv'], ['razon_social', 'rut', 'razon_social'],
  ['direccion_seccional', 'rut', 'direccion_seccional'], ['correo_electronico', 'rut', 'email'],
  ['direccion', 'rut', 'direccion'], ['telefono', 'rut', 'telefono'], ['pais', 'rut', 'pais'],
  ['departamento', 'rut', 'departamento'], ['municipio', 'rut', 'municipio'],
  ['primer_apellido', 'rut', 'primer_apellido'], ['segundo_apellido', 'rut', 'segundo_apellido'],
  ['primer_nombre', 'rut', 'primer_nombre'], ['otros_nombres', 'rut', 'otros_nombres'],
  ['codigo_pais', 'rut', 'codigo_pais'], ['codigo_departamento', 'rut', 'codigo_departamento'],
  ['codigo_municipio', 'rut', 'codigo_municipio'],
  ['numero_factura', 'factura', 'numero_factura'], ['fecha_factura', 'factura', 'fecha_factura'],
  ['valor_iva', 'factura', 'valor_iva'], ['valor_solicitado', 'factura', 'valor_iva'],
  ['entidad_financiera', 'cert', 'entidad_financiera'], ['numero_cuenta', 'cert', 'numero_cuenta'],
  ['tipo_cuenta', 'cert', 'tipo_cuenta'],
]

function pick(dir: string, re: RegExp): string | null {
  const f = readdirSync(dir).find((x) => re.test(x))
  return f ? join(dir, f) : null
}
function mime(path: string): string {
  const l = path.toLowerCase()
  if (l.endsWith('.png')) return 'image/png'
  if (l.endsWith('.jpg') || l.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/pdf'
}

async function extraer(dir: string, re: RegExp, campos: CampoExtraccion[], key: string, label: string) {
  const path = pick(dir, re)
  if (!path) { console.log(`  ⚠️  ${label}: NO encontrado`); return {} as Record<string, { value: string | null; confidence: number; manual: boolean }> }
  const { data, error } = await extractFieldsFromDocument(readFileSync(path), mime(path), campos, key)
  if (error || !data) { console.log(`  ❌ ${label}: ${error}`); return {} }
  console.log(`  ✓ ${label} (${path.split('/').pop()})`)
  return data
}

async function main() {
  const dir = process.argv[2] || '/tmp/paola'
  const key = loadGeminiKey()
  if (!key) { console.error('GEMINI_API_KEY no disponible'); process.exit(1) }

  console.log(`\n=== DRY-RUN cargue IVA · ${dir} ===\nExtrayendo documentos fuente con gemini-2.5-flash...\n`)
  const rut = await extraer(dir, /rut/i, RUT, key, 'RUT')
  const fac = await extraer(dir, /factura/i, FACTURA, key, 'Factura')
  const cert = await extraer(dir, /certificado_banc|certificado bancario|banco/i, CERT, key, 'Certificado bancario')
  const src = { rut, factura: fac, cert }

  console.log(`\n=== Formulario 010 resuelto por ONE (24 casillas) ===`)
  let faltan = 0
  for (const [casilla, bloque, campo] of MAPA_010) {
    const r = (src as Record<string, Record<string, { value: string | null; confidence: number; manual: boolean }>>)[bloque]?.[campo]
    const v = r?.value ?? null
    const flag = v == null ? '  ‹FALTA›' : (r?.manual ? `  ‹revisar c=${r.confidence}›` : '')
    if (v == null) faltan++
    console.log(`  ${casilla.padEnd(22)} ${String(v ?? '—').padEnd(40)}${flag}`)
  }
  console.log(`\n  Casillas vacías: ${faltan}/${MAPA_010.length}`)
  console.log(`\nValida estos valores contra 007_Formulario_010_DIAN.pdf (ground truth).`)
}
main().catch((e) => { console.error(e); process.exit(1) })
