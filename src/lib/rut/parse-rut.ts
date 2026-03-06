// ============================================================
// RUT OCR Parser — Gemini 2.5 Flash
// Spec: [98B] D69-D77
// Pattern: wa-transcribe.ts (inline_data base64)
// ============================================================

import type { RutParseResult, RutField } from './types'
import { validateNit } from './validate-nit'

const GEMINI_MODEL = 'gemini-2.5-flash'

const SYSTEM_PROMPT = `Eres un extractor de datos del RUT colombiano (Registro Unico Tributario de la DIAN).

Tu trabajo: recibir una imagen o PDF del formulario RUT y extraer campos estructurados en JSON.

CAMPOS A EXTRAER (referencia a casillas del formulario RUT DIAN):
- nit: NIT sin digito de verificacion (casilla 5). Solo digitos.
- digito_verificacion: Digito de verificacion (casilla 6). Un solo digito.
- razon_social: Nombre o razon social completa (casillas 5-6 area de nombre, o casillas 31-35)
- tipo_documento: Tipo de documento. Valores: "NIT", "CC", "CE", "TI", "PA". (casilla 24)
- tipo_persona: Si es persona natural o juridica. Valores: "natural", "juridica". (casilla 25: 1=juridica, 2=natural)
- direccion_fiscal: Direccion completa (casillas 38-42 concatenadas)
- municipio: Nombre del municipio (casilla 44)
- departamento: Nombre del departamento
- telefono: Telefono 1 (casilla 46). Solo digitos.
- email_fiscal: Correo electronico (casilla 48)
- regimen_tributario: Determinar del campo responsabilidades. Valores: "responsable" (si tiene responsabilidad 48 IVA), "no_responsable" (si tiene 49), "simple" (si tiene regimen simple SIMPLE).
- responsable_iva: true si la casilla 53 incluye responsabilidad 48 (IVA), false si incluye 49.
- gran_contribuyente: true si la casilla 53 incluye responsabilidad 13 (Gran Contribuyente), false en otro caso.
- agente_retenedor: true si la casilla 53 incluye responsabilidad 07 (Agente Retencion), false en otro caso.
- autorretenedor: true si la casilla 53 incluye responsabilidad 23 (Autorretenedor), false en otro caso.
- actividad_ciiu: Codigo CIIU de actividad economica principal (casilla 46). Formato: 4 digitos.
- actividad_secundaria: Codigo CIIU secundario si existe.
- fecha_inicio_actividades: Fecha de inicio actividades (casilla 25). Formato: YYYY-MM-DD.

REGLAS:
- Responde SOLO con JSON valido, sin texto adicional
- Para cada campo devuelve un objeto { "value": <valor_extraido>, "confidence": <0.0 a 1.0> }
- Si no puedes leer un campo, usa { "value": null, "confidence": 0.0 }
- confidence refleja que tan seguro estas de la lectura (1.0 = perfectamente legible, 0.5 = borroso pero probable, 0.0 = no visible)
- Los NITs colombianos tienen tipicamente 9 digitos. Si lees menos, baja la confianza.
- Limpia los valores: sin espacios al inicio/final, NIT solo digitos, telefono solo digitos.

FORMATO DE RESPUESTA:
{
  "nit": { "value": "900123456", "confidence": 0.95 },
  "digito_verificacion": { "value": "7", "confidence": 0.95 },
  "razon_social": { "value": "EMPRESA EJEMPLO SAS", "confidence": 0.90 },
  "tipo_documento": { "value": "NIT", "confidence": 0.98 },
  "tipo_persona": { "value": "juridica", "confidence": 0.95 },
  "direccion_fiscal": { "value": "CL 100 19A 61 OF 503", "confidence": 0.85 },
  "municipio": { "value": "BOGOTA", "confidence": 0.90 },
  "departamento": { "value": "CUNDINAMARCA", "confidence": 0.90 },
  "telefono": { "value": "6011234567", "confidence": 0.80 },
  "email_fiscal": { "value": "info@ejemplo.com", "confidence": 0.90 },
  "regimen_tributario": { "value": "responsable", "confidence": 0.85 },
  "responsable_iva": { "value": true, "confidence": 0.85 },
  "gran_contribuyente": { "value": false, "confidence": 0.90 },
  "agente_retenedor": { "value": true, "confidence": 0.85 },
  "autorretenedor": { "value": false, "confidence": 0.90 },
  "actividad_ciiu": { "value": "6201", "confidence": 0.85 },
  "actividad_secundaria": { "value": null, "confidence": 0.0 },
  "fecha_inicio_actividades": { "value": "2015-03-15", "confidence": 0.80 }
}`

/** Supported MIME types for RUT documents */
const SUPPORTED_MIMES: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
}

/**
 * Parse a RUT document (image or PDF) using Gemini 2.5 Flash OCR.
 * Returns structured data with per-field confidence scores.
 *
 * IMPORTANT: apiKey must be passed from the server action caller
 * (process.env is not reliably available in library files on Vercel).
 */
export async function parseRut(
  fileBuffer: ArrayBuffer,
  mimeType: string,
  apiKey: string,
): Promise<{ data: RutParseResult | null; error?: string }> {
  if (!apiKey) {
    return { data: null, error: 'GEMINI_API_KEY no configurada en el servidor' }
  }

  const normalizedMime = SUPPORTED_MIMES[mimeType.toLowerCase()]
  if (!normalizedMime) {
    return { data: null, error: `Tipo de archivo no soportado: ${mimeType}` }
  }

  // Convert ArrayBuffer to base64
  const base64 = Buffer.from(fileBuffer).toString('base64')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            parts: [
              { text: 'Extrae todos los campos de este documento RUT colombiano.' },
              { inline_data: { mime_type: normalizedMime, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`[parse-rut] Gemini HTTP error: ${res.status} — ${errBody.slice(0, 500)}`)
      return { data: null, error: `Error de Gemini (${res.status})` }
    }

    const data = await res.json()

    // Check for blocked content
    const blockReason = data.promptFeedback?.blockReason
    if (blockReason) {
      return { data: null, error: `Contenido bloqueado por Gemini: ${blockReason}` }
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      return { data: null, error: 'Gemini no devolvio respuesta' }
    }

    // Clean response: strip markdown fences, BOM, trailing commas
    const text = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .replace(/,\s*([}\]])/g, '$1')
      .trim()

    // Parse the JSON response
    const raw = JSON.parse(text) as Record<string, RutField<unknown>>

    // Build typed result
    const result = buildResult(raw)

    return { data: result }
  } catch (err) {
    console.error('[parse-rut] Exception:', err)
    return { data: null, error: `Error procesando RUT: ${String(err).slice(0, 200)}` }
  }
}

/** Build a typed RutParseResult from raw Gemini JSON, including NIT validation */
function buildResult(raw: Record<string, RutField<unknown>>): RutParseResult {
  const field = <T>(key: string): RutField<T> => {
    const f = raw[key]
    if (!f || f.value === undefined) return { value: null, confidence: 0 }
    return { value: f.value as T, confidence: f.confidence ?? 0 }
  }

  const strField = (key: string): RutField<string> => {
    const f = field<string>(key)
    if (f.value !== null) f.value = String(f.value).trim()
    if (f.value === '') f.value = null
    return f
  }

  const boolField = (key: string): RutField<boolean> => {
    const f = field<boolean>(key)
    if (f.value !== null && typeof f.value !== 'boolean') {
      // Handle string "true"/"false" from Gemini
      f.value = String(f.value).toLowerCase() === 'true'
    }
    return f
  }

  // Extract all fields
  const nit = strField('nit')
  const digito_verificacion = strField('digito_verificacion')
  const razon_social = strField('razon_social')
  const tipo_documento = strField('tipo_documento')
  const tipo_persona = strField('tipo_persona')
  const direccion_fiscal = strField('direccion_fiscal')
  const municipio = strField('municipio')
  const departamento = strField('departamento')
  const telefono = strField('telefono')
  const email_fiscal = strField('email_fiscal')
  const regimen_tributario = strField('regimen_tributario')
  const responsable_iva = boolField('responsable_iva')
  const gran_contribuyente = boolField('gran_contribuyente')
  const agente_retenedor = boolField('agente_retenedor')
  const autorretenedor = boolField('autorretenedor')
  const actividad_ciiu = strField('actividad_ciiu')
  const actividad_secundaria = strField('actividad_secundaria')
  const fecha_inicio_actividades = strField('fecha_inicio_actividades')

  // NIT validation via modulo-11
  const nit_valid = !!(nit.value && digito_verificacion.value &&
    validateNit(nit.value, digito_verificacion.value))

  // Calculate overall confidence (average of non-null fields)
  const allFields = [
    nit, digito_verificacion, razon_social, tipo_documento, tipo_persona,
    direccion_fiscal, municipio, departamento, telefono, email_fiscal,
    regimen_tributario, responsable_iva, gran_contribuyente, agente_retenedor,
    autorretenedor, actividad_ciiu, actividad_secundaria, fecha_inicio_actividades,
  ]
  const nonNull = allFields.filter(f => f.value !== null)
  const overall_confidence = nonNull.length > 0
    ? nonNull.reduce((sum, f) => sum + f.confidence, 0) / nonNull.length
    : 0

  return {
    nit,
    digito_verificacion,
    razon_social,
    tipo_documento,
    tipo_persona,
    direccion_fiscal,
    municipio,
    departamento,
    telefono,
    email_fiscal,
    regimen_tributario,
    responsable_iva,
    gran_contribuyente,
    agente_retenedor,
    autorretenedor,
    actividad_ciiu,
    actividad_secundaria,
    fecha_inicio_actividades,
    overall_confidence,
    nit_valid,
  }
}
