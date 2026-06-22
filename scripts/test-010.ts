/**
 * Genera un Formulario 010 de PRUEBA con datos realistas (persona natural) para
 * validar coordenadas/render sin tocar la DB ni la app. No es código de producto.
 *
 * Uso:  npx tsx scripts/test-010.ts   →  escribe /tmp/test-010.pdf
 */
import { generarFormulario010, type Formulario010Datos, type Formulario010Constantes } from '../src/lib/pdf/formulario-010'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'

const datos: Formulario010Datos = {
  nit: '72798785',
  dv: '2',
  tipo_documento: null, // casilla 20 forzada a "13" (CC) en el generador
  primer_apellido: 'RAMIREZ',
  segundo_apellido: 'GOMEZ',
  primer_nombre: 'OSCAR',
  otros_nombres: '',
  razon_social: null, // persona natural → casilla 11 SIEMPRE en blanco
  direccion_seccional: 'Tuluá',
  correo_electronico: 'oscar.ramirez@correo.com',
  direccion: 'CALLE 10 # 5-20',
  telefono: '3001234567',
  pais: 'Colombia',
  departamento: 'Valle del Cauca',
  municipio: 'Tuluá',
  codigo_pais: '169',
  codigo_departamento: '76',
  codigo_municipio: '76834',
  entidad_financiera: 'Bancolombia',
  numero_cuenta: '12345678901',
  tipo_cuenta: 'Ahorros',
  valor_solicitado: '5320000',
  numero_factura: 'FE-1234',
  fecha_factura: '2026-06-15', // junio → bimestre 3
  nombre_suscriptor: null,
  tipo_doc_suscriptor: null,
  identificacion_suscriptor: null,
  dv_suscriptor: null,
}

const constantes: Formulario010Constantes = {
  concepto: '06',
  tipo_solicitud: 'A solicitud de parte',
  tipo_obligacion: 'Beneficio tributario',
  concepto_saldo: 'Pago de lo no debido. Otros: UPME',
  nombre_documento: 'Factura electrónica de ventas',
}

async function main() {
  const bytes = await generarFormulario010(datos, constantes)
  const out = '/tmp/test-010.pdf'
  fs.writeFileSync(out, bytes)
  console.log('✓ PDF de prueba generado en', out)

  const doc = await PDFDocument.load(bytes)
  const fields = doc.getForm().getFields().map(f => `${f.constructor.name}:${f.getName()}`)
  console.log(`\nCampos de formulario editables (${fields.length}):`)
  fields.forEach(f => console.log('  -', f))
}

main().catch((e) => { console.error('✗ ERROR:', e); process.exit(1) })
