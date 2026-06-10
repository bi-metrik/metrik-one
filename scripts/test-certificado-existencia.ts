/**
 * Valida la extracción AI del bloque "Certificado de existencia" (persona jurídica)
 * contra un certificado real de Cámara de Comercio, SIN tocar DB ni app.
 *
 * Uso:  npx tsx scripts/test-certificado-existencia.ts [ruta.pdf]
 *   (default: el certificado de ETEX en ~/Downloads/Soena)
 */
import { extractFieldsFromDocument, type CampoExtraccion } from '../src/lib/ai/extract-fields'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Mismos campos que la migración 20260609_flujo_persona_juridica.sql
const campos: CampoExtraccion[] = [
  { slug: 'razon_social', tipo: 'texto', label: 'Razón social', required: true,
    descripcion_ai: 'Razón social completa de la persona jurídica, tal como aparece en la sección NOMBRE, IDENTIFICACIÓN Y DOMICILIO del certificado de Cámara de Comercio.' },
  { slug: 'nit', tipo: 'texto', label: 'NIT', required: true,
    descripcion_ai: 'NIT de la persona jurídica SIN dígito de verificación y SIN guion. Solo dígitos (ej: del NIT 890800148-3 extraer 890800148).' },
  { slug: 'dv', tipo: 'texto', label: 'DV', required: false,
    descripcion_ai: 'Dígito de verificación del NIT, un solo dígito (ej: del NIT 890800148-3 extraer 3).' },
  { slug: 'direccion', tipo: 'texto', label: 'Dirección', required: true,
    descripcion_ai: 'Dirección del domicilio principal de la sociedad (renglón Dirección del domicilio principal en la sección UBICACIÓN).' },
  { slug: 'municipio', tipo: 'texto', label: 'Municipio', required: true,
    descripcion_ai: 'Municipio del domicilio principal (solo el municipio, sin el departamento; ej: de Manizales, Caldas extraer Manizales).' },
  { slug: 'departamento', tipo: 'texto', label: 'Departamento', required: false,
    descripcion_ai: 'Departamento del domicilio principal (ej: de Manizales, Caldas extraer Caldas).' },
  { slug: 'telefono', tipo: 'texto', label: 'Teléfono', required: false,
    descripcion_ai: 'Teléfono comercial principal de la sociedad. Si hay varios, tomar el primero. Solo dígitos.' },
  { slug: 'email', tipo: 'texto', label: 'Correo', required: true,
    descripcion_ai: 'Correo electrónico de la sociedad (campo Correo electrónico en la sección UBICACIÓN).' },
  { slug: 'representante_legal', tipo: 'texto', label: 'Representante legal', required: false,
    descripcion_ai: 'Nombre completo del representante legal (gerente general) de la sociedad. Suele aparecer en la sección de NOMBRAMIENTOS, más adelante en el certificado. Si no aparece, dejar vacío.' },
]

function loadApiKey(): string {
  const envPath = path.join(process.cwd(), '.env.local')
  const txt = fs.readFileSync(envPath, 'utf8')
  const m = txt.match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m)
  if (!m) throw new Error('GEMINI_API_KEY no encontrada en .env.local')
  return m[1].trim().replace(/^["']|["']$/g, '')
}

async function main() {
  const file = process.argv[2] || path.join(os.homedir(), 'Downloads/Soena/7. CC ETEX COLOMBIA 06-05-2026.pdf')
  const buffer = fs.readFileSync(file)
  const apiKey = loadApiKey()
  console.log(`Documento: ${file} (${(buffer.length / 1024).toFixed(0)} KB)\n`)

  const { data, error } = await extractFieldsFromDocument(buffer, 'application/pdf', campos, apiKey)
  if (error) { console.error('✗ ERROR:', error); process.exit(1) }
  if (!data) { console.error('✗ Sin datos'); process.exit(1) }

  console.log('Campos extraídos:')
  for (const c of campos) {
    const r = data[c.slug]
    const conf = r ? `${Math.round(r.confidence * 100)}%` : '—'
    console.log(`  ${c.slug.padEnd(20)} = ${String(r?.value ?? '∅').padEnd(45)} [${conf}]`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
