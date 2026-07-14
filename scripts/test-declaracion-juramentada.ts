/**
 * Genera una Declaración Juramentada de PRUEBA (nuevo formato corto) con datos
 * hardcoded para validar el render sin tocar la DB ni la app. No es código de producto.
 *
 * Uso:  npx tsx scripts/test-declaracion-juramentada.ts   →  escribe /tmp/test-declaracion-juramentada.pdf
 */
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import DeclaracionJuramentadaPDF from '../src/lib/pdf/declaracion-juramentada-pdf'
import fs from 'fs'

async function main() {
  const element = createElement(DeclaracionJuramentadaPDF, {
    datos: {
      nombre_solicitante: 'OSCAR RAMIREZ GOMEZ',
      numero_identificacion: '72798785', // NIT tal cual el RUT, sin DV pegado
      tipo_vehiculo: 'Tesla Model 3', // ya no se usa; se pasa para probar retrocompat del caller
      email: 'oscar.ramirez@correo.com',
      telefono: '+57 3001234567',
      municipio: 'Tuluá',
    },
    fechaGeneracion: '2026-07-14',
    codigoNegocio: 'V0031',
  })

  const buffer = await renderToBuffer(element)
  const out = '/tmp/test-declaracion-juramentada.pdf'
  fs.writeFileSync(out, buffer)
  console.log(`OK — ${buffer.length} bytes → ${out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
