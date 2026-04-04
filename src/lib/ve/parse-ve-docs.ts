// ============================================================
// VE Documents OCR Parser — Gemini 2.5 Flash
// Extrae datos de vehiculo de facturas y fichas tecnicas colombianas.
// Pattern: parse-rut.ts (inline_data base64, structured output)
// ============================================================

const GEMINI_MODEL = 'gemini-2.5-flash'

const SYSTEM_PROMPT = `Eres un extractor de datos de tramites de vehiculos colombianos.

Tu trabajo: recibir uno o varios documentos relacionados con un tramite de vehiculo electrico (VE), hibrido (HEV/PHEV) o de combustion en Colombia, y extraer datos estructurados en JSON.

TIPOS DE DOCUMENTOS QUE PUEDES RECIBIR:
- Ficha tecnica del vehiculo: contiene datos tecnicos del vehiculo (marca, linea, modelo, tecnologia, tipo)
- Factura de compraventa: contiene datos del vehiculo + datos del comprador (nombre, numero de identificacion)
- Cedula de ciudadania: contiene datos del propietario (nombre completo, numero de cedula)
- Certificado de emisiones: contiene datos del vehiculo

CAMPOS A EXTRAER:

DATOS DEL VEHICULO (presentes en facturas y fichas tecnicas):
- marca_vehiculo: Marca del fabricante (ej: "RENAULT", "BYD", "CHEVROLET", "KIA", "NISSAN")
- linea_vehiculo: Linea o referencia del modelo (ej: "KWID E-TECH", "DOLPHIN", "SPARK EV")
- modelo_ano: Ano del modelo como string de 4 digitos (ej: "2024", "2023")
- tecnologia: Tipo de propulsion. Valores: "EV", "HEV", "PHEV", "MOTO EV"
  - EV: 100% electrico
  - HEV: hibrido convencional (sin recarga externa)
  - PHEV: hibrido enchufable (con recarga externa)
  - MOTO EV: motocicleta electrica
- tipo_vehiculo: Tipo de carroceria. Valores: "Automovil", "Camioneta"
  - Automovil: sedan, hatchback, coupe, station wagon
  - Camioneta: SUV, pickup, van, furgon

DATOS DEL PROPIETARIO (presentes en cedulas y facturas de compraventa):
- nombre_propietario: Nombre completo o razon social del propietario/comprador (ej: "MARIO ANDRES RESTREPO GARCIA")
- numero_identificacion: Numero de cedula o NIT sin puntos ni guiones (ej: "52823610515", "900123456")

REGLAS:
- Responde SOLO con JSON valido, sin texto adicional
- Para cada campo devuelve { "value": <valor>, "confidence": <0.0 a 1.0> }
- Si un campo no esta en el documento recibido, usa { "value": null, "confidence": 0.0 }
- confidence refleja certeza de lectura (1.0 = perfectamente legible, 0.5 = borroso pero probable, 0.0 = no visible)
- Para tecnologia: "ELECTRICO" o "BEV" → "EV". "HIBRIDO" sin recarga → "HEV". "PLUG-IN" o "PHEV" → "PHEV"
- Limpia valores: sin espacios al inicio/final, marca/linea/nombre en MAYUSCULAS
- numero_identificacion: solo digitos, sin puntos, guiones ni espacios

FORMATO DE RESPUESTA:
{
  "marca_vehiculo": { "value": "BYD", "confidence": 0.98 },
  "linea_vehiculo": { "value": "DOLPHIN", "confidence": 0.95 },
  "modelo_ano": { "value": "2024", "confidence": 0.97 },
  "tecnologia": { "value": "EV", "confidence": 0.92 },
  "tipo_vehiculo": { "value": "Automovil", "confidence": 0.90 },
  "nombre_propietario": { "value": "MARIO ANDRES RESTREPO GARCIA", "confidence": 0.96 },
  "numero_identificacion": { "value": "52823610515", "confidence": 0.98 }
}`

// JSON Schema for Gemini structured output — forces valid JSON at decode level
const VE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: Object.fromEntries(
    ['marca_vehiculo', 'linea_vehiculo', 'modelo_ano', 'tecnologia', 'tipo_vehiculo', 'nombre_propietario', 'numero_identificacion'].map(k => [k, {
      type: 'OBJECT',
      properties: {
        value: { type: 'STRING', nullable: true },
        confidence: { type: 'NUMBER' },
      },
      required: ['value', 'confidence'],
    }])
  ),
  required: ['marca_vehiculo', 'linea_vehiculo', 'modelo_ano', 'tecnologia', 'tipo_vehiculo', 'nombre_propietario', 'numero_identificacion'],
}

/** Per-field structure returned by Gemini */
export interface VeVehicleField {
  value: string | null
  confidence: number
}

/** Full structured result for a VE document parse */
export interface VeVehicleData {
  marca_vehiculo: VeVehicleField
  linea_vehiculo: VeVehicleField
  modelo_ano: VeVehicleField
  tecnologia: VeVehicleField
  tipo_vehiculo: VeVehicleField
  nombre_propietario: VeVehicleField
  numero_identificacion: VeVehicleField
  overall_confidence: number
}

/** Supported MIME types for VE documents */
const SUPPORTED_MIMES: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
}

/**
 * Attempt to repair malformed JSON from Gemini.
 * Handles: single quotes, unquoted keys, trailing commas, truncated output.
 */
function repairJson(text: string): string {
  let s = text
    .replace(/^\uFEFF/, '')                       // BOM
    .replace(/^```(?:json)?\s*/i, '')             // opening fence
    .replace(/\s*```\s*$/, '')                    // closing fence
    .trim()

  // Extract outermost {...} if there's surrounding text
  const braceStart = s.indexOf('{')
  const braceEnd = s.lastIndexOf('}')
  if (braceStart >= 0 && braceEnd > braceStart) {
    s = s.slice(braceStart, braceEnd + 1)
  }

  // Fix trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1')

  // Fix single-quoted strings → double-quoted
  s = s.replace(/'/g, '"')

  // Fix unquoted keys: word: → "word":
  s = s.replace(/(?<=[\{,]\s*)(\w+)\s*:/g, '"$1":')

  return s
}

/**
 * Parse one or more VE documents (facturas, fichas tecnicas) using Gemini 2.5 Flash OCR.
 * All documents are sent in a single request as multiple inline_data parts.
 * Returns structured vehicle data with per-field confidence scores.
 *
 * IMPORTANT: apiKey must be passed from the server action caller
 * (process.env is not reliably available in library files on Vercel).
 */
export async function parseVeDocuments(
  docs: Array<{ buffer: ArrayBuffer; mimeType: string; slug: string }>,
  apiKey: string,
): Promise<{ data: VeVehicleData | null; error?: string }> {
  if (!apiKey) {
    return { data: null, error: 'GEMINI_API_KEY no configurada en el servidor' }
  }

  if (docs.length === 0) {
    return { data: null, error: 'No se proporcionaron documentos para procesar' }
  }

  // Build inline_data parts — one per document
  const inlineParts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: 'Extrae los datos del vehiculo de los siguientes documentos colombianos.' },
  ]

  for (const doc of docs) {
    const normalizedMime = SUPPORTED_MIMES[doc.mimeType.toLowerCase()]
    if (!normalizedMime) {
      console.warn(`[parse-ve-docs] Tipo no soportado para ${doc.slug}: ${doc.mimeType}, omitiendo`)
      continue
    }
    const base64 = Buffer.from(doc.buffer).toString('base64')
    inlineParts.push({ text: `Documento: ${doc.slug}` })
    inlineParts.push({ inline_data: { mime_type: normalizedMime, data: base64 } })
  }

  if (inlineParts.length === 1) {
    // Only the initial text part — no valid docs were added
    return { data: null, error: 'Ninguno de los documentos tiene un tipo MIME soportado' }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  let debugRaw = ''
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            parts: inlineParts,
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
          responseSchema: VE_RESPONSE_SCHEMA,
        },
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`[parse-ve-docs] Gemini HTTP error: ${res.status} — ${errBody.slice(0, 500)}`)
      return { data: null, error: `Error de Gemini (${res.status})` }
    }

    const data = await res.json()

    // Check for blocked content
    const blockReason = data.promptFeedback?.blockReason
    if (blockReason) {
      return { data: null, error: `Contenido bloqueado por Gemini: ${blockReason}` }
    }

    // Gemini 2.5 Flash has built-in thinking — response may have multiple parts:
    // parts[0] = { thought: true, text: "reasoning..." }
    // parts[1] = { text: '{"marca_vehiculo": ...}' }  <-- the actual JSON
    const parts = data.candidates?.[0]?.content?.parts || []

    // Find the non-thought part (the actual JSON response)
    const jsonPart = parts.find(
      (p: { thought?: boolean; text?: string }) => !p.thought && p.text
    ) || parts[parts.length - 1]

    debugRaw = jsonPart?.text || ''
    if (!debugRaw) {
      return { data: null, error: 'Gemini no devolvio respuesta' }
    }

    // Parse JSON — with responseSchema, Gemini should always produce valid JSON.
    // Fallback: repair common malformations if it still fails.
    let raw: Record<string, VeVehicleField>
    try {
      raw = JSON.parse(debugRaw)
    } catch {
      console.warn('[parse-ve-docs] Direct parse failed, attempting repair...')
      const repaired = repairJson(debugRaw)
      try {
        raw = JSON.parse(repaired)
      } catch (e2) {
        console.error('[parse-ve-docs] Repair also failed. Raw:', debugRaw.slice(0, 600))
        throw new Error(`JSON invalido de Gemini: ${String(e2).slice(0, 80)}`)
      }
    }

    // Build typed result
    const result = buildResult(raw)
    return { data: result }
  } catch (err) {
    console.error('[parse-ve-docs] Exception:', err, '\n[parse-ve-docs] Raw:', debugRaw.slice(0, 800))
    return { data: null, error: `Error procesando documentos VE: ${String(err).slice(0, 120)}` }
  }
}

/** Build a typed VeVehicleData from raw Gemini JSON */
function buildResult(raw: Record<string, VeVehicleField>): VeVehicleData {
  const strField = (key: string): VeVehicleField => {
    const f = raw[key]
    if (!f || f.value === undefined) return { value: null, confidence: 0 }
    let value = f.value !== null ? String(f.value).trim() : null
    if (value === '') value = null
    return { value, confidence: f.confidence ?? 0 }
  }

  const marca_vehiculo = strField('marca_vehiculo')
  const linea_vehiculo = strField('linea_vehiculo')
  const modelo_ano = strField('modelo_ano')
  const tecnologia = strField('tecnologia')
  const tipo_vehiculo = strField('tipo_vehiculo')
  const nombre_propietario = strField('nombre_propietario')
  const numero_identificacion = strField('numero_identificacion')

  // Calculate overall confidence (average of non-null fields)
  const allFields = [marca_vehiculo, linea_vehiculo, modelo_ano, tecnologia, tipo_vehiculo, nombre_propietario, numero_identificacion]
  const nonNull = allFields.filter(f => f.value !== null)
  const overall_confidence = nonNull.length > 0
    ? nonNull.reduce((sum, f) => sum + f.confidence, 0) / nonNull.length
    : 0

  return {
    marca_vehiculo,
    linea_vehiculo,
    modelo_ano,
    tecnologia,
    tipo_vehiculo,
    nombre_propietario,
    numero_identificacion,
    overall_confidence,
  }
}
