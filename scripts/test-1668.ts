/**
 * Genera un Formulario 1668 de PRUEBA (persona natural) para validar el render
 * AcroForm editable sin tocar la DB ni la app. No es código de producto.
 *
 * Uso:  npx tsx scripts/test-1668.ts   →  escribe /tmp/test-1668.pdf
 * Imprime además la lista de campos de formulario detectados (editables).
 */
import { generarFormulario1668, type Formulario1668Datos, type Formulario1668Constantes } from '../src/lib/pdf/formulario-1668'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'

const datos: Formulario1668Datos = {
  numero_identificacion: '72798785',
  dv: '2',
  primer_apellido: 'RAMIREZ',
  segundo_apellido: 'GOMEZ',
  primer_nombre: 'OSCAR',
  otros_nombres: '',
  razon_social: null, // persona natural → casilla 11 en blanco
  fecha_expedicion: '2026-05-20',
  entidad_financiera: 'Bancolombia',
  numero_cuenta: '12345678901',
  tipo_cuenta: 'Ahorros',
}

const constantes: Formulario1668Constantes = {
  tipo_documento: '13', // Cédula de Ciudadanía
  cod_representacion: '01',
}

async function main() {
  const bytes = await generarFormulario1668(datos, constantes)
  const out = '/tmp/test-1668.pdf'
  fs.writeFileSync(out, bytes)
  console.log('✓ PDF de prueba generado en', out)

  // Verificar que los campos editables existen y los deterministas NO son campos.
  const doc = await PDFDocument.load(bytes)
  const fields = doc.getForm().getFields().map(f => `${f.constructor.name}:${f.getName()}`)
  console.log(`\nCampos de formulario (${fields.length}):`)
  fields.forEach(f => console.log('  -', f))
}

main().catch((e) => { console.error('✗ ERROR:', e); process.exit(1) })
