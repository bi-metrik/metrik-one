/**
 * Valida la extracción AI del Concepto UPME con DOS beneficiarios (leasing/copropiedad)
 * contra un certificado real, SIN tocar DB ni app.
 * Uso:  npx tsx scripts/test-concepto-upme-2sol.ts [ruta.pdf]
 */
import { extractFieldsFromDocument, type CampoExtraccion } from '../src/lib/ai/extract-fields'
import fs from 'fs'
import path from 'path'

const campos: CampoExtraccion[] = [
  { slug: 'numero_caso_upme', tipo: 'texto', label: 'Caso', required: true,
    descripcion_ai: 'Número de caso UPME, formato VEH_GEE seguido de dígitos. Buscar en RADICADO No.' },
  { slug: 'nombre_certificado', tipo: 'texto', label: 'Nombre 1º', required: true,
    descripcion_ai: 'Nombre completo o razón social del PRIMER beneficiario en BENEFICIARIOS. Texto tal como aparece.' },
  { slug: 'numero_identificacion_certificado', tipo: 'texto', label: 'ID 1º', required: true,
    descripcion_ai: 'Cédula o NIT del PRIMER beneficiario en BENEFICIARIOS, solo dígitos.' },
  { slug: 'nombre_certificado_2', tipo: 'texto', label: 'Nombre 2º', required: false,
    descripcion_ai: 'Nombre completo o razón social del SEGUNDO beneficiario (segunda fila Dueño del Proyecto) en BENEFICIARIOS, SOLO si la tabla lista dos. Vacío si solo hay uno.' },
  { slug: 'numero_identificacion_certificado_2', tipo: 'texto', label: 'ID 2º', required: false,
    descripcion_ai: 'Cédula o NIT del SEGUNDO beneficiario en BENEFICIARIOS, solo dígitos. Vacío si solo hay uno.' },
  { slug: 'marca_certificado', tipo: 'texto', label: 'Marca', required: true,
    descripcion_ai: 'Marca del vehículo en BIENES APROBADOS.' },
  { slug: 'linea_modelo_certificado', tipo: 'texto', label: 'Línea/modelo', required: true,
    descripcion_ai: 'Línea y modelo del vehículo en BIENES APROBADOS, incluye el año.' },
]

function loadApiKey(): string {
  const txt = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
  const m = txt.match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m)
  if (!m) throw new Error('GEMINI_API_KEY no encontrada')
  return m[1].trim().replace(/^["']|["']$/g, '')
}

async function main() {
  const file = process.argv[2] || '/Users/mauricio/Downloads/SOE035-56289631131- GERARDO REYES/CERTIFICACION /CertificadoVehiculosElectricos (7).pdf'
  const buffer = fs.readFileSync(file)
  const { data, error } = await extractFieldsFromDocument(buffer, 'application/pdf', campos, loadApiKey())
  if (error) { console.error('✗', error); process.exit(1) }
  for (const c of campos) {
    const r = data?.[c.slug]
    console.log(`  ${c.slug.padEnd(36)} = ${String(r?.value ?? '∅').padEnd(30)} [${r ? Math.round(r.confidence * 100) : 0}%]`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
