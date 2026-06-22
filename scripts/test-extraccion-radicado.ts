/**
 * QA de la extracción del número de radicado desde un pantallazo (campo
 * imagen_clipboard con `extrae`). Corre Gemini con la MISMA descripcion_ai que
 * la migración 20260622_extraccion_radicado_imagen.sql y verifica el resultado.
 * No toca DB ni app.
 *
 * Uso:  npx tsx --env-file=.env.local scripts/test-extraccion-radicado.ts
 */
import { extractFieldsFromDocument, type CampoExtraccion } from '../src/lib/ai/extract-fields'
import fs from 'fs'

const DESC_INCLUSION =
  'Número de radicado de inclusión ante la UPME. Aparece en el encabezado del panel ' +
  'lateral DERECHO de la pantalla, como "Caso VEH_GEE..." junto a una estrella. El ' +
  'formato es el prefijo VEH_GEE seguido de dígitos, por ejemplo VEH_GEE202638875. ' +
  'Devuelve el código COMPLETO incluyendo el prefijo "VEH_GEE", sin espacios. No ' +
  'confundir con el NIT del solicitante ni con valores monetarios de la tabla del vehículo.'

const campos: CampoExtraccion[] = [{
  slug: 'radicado_inclusion',
  label: 'Número de radicado (inclusión)',
  tipo: 'texto',
  required: true,
  descripcion_ai: DESC_INCLUSION,
}]

const DIR = '/Users/mauricio/Downloads/formularios upme'
const CASOS: Array<{ archivo: string; esperado: string }> = [
  { archivo: 'image (1).png', esperado: 'VEH_GEE202638875' },
  { archivo: 'image (2).png', esperado: 'VEH_GEE202638873' },
  { archivo: 'image (1) copy.png', esperado: 'VEH_GEE202638913' },
]

async function main() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) { console.error('Falta GEMINI_API_KEY'); process.exit(1) }

  let ok = 0
  for (const caso of CASOS) {
    const buffer = fs.readFileSync(`${DIR}/${caso.archivo}`)
    const { data, error } = await extractFieldsFromDocument(buffer, 'image/png', campos, apiKey)
    const r = data?.radicado_inclusion
    const value = r?.value ?? null
    const pass = value === caso.esperado
    if (pass) ok++
    console.log(
      `${pass ? '✅' : '❌'} ${caso.archivo}\n` +
      `   esperado: ${caso.esperado}\n` +
      `   obtenido: ${value ?? '(null)'}  conf=${r?.confidence ?? '-'}  ${error ? `err=${error}` : ''}`
    )
  }
  console.log(`\n${ok}/${CASOS.length} correctos`)
  process.exit(ok === CASOS.length ? 0 : 1)
}

main()
