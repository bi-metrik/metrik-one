// ============================================================
// Generic AI Field Extractor - Gemini 3.1 Flash-Lite
// Extrae campos configurables de cualquier documento.
// Pattern: parse-ve-docs.ts (inline_data base64, structured output)
// ============================================================

const GEMINI_MODEL = 'gemini-3.1-flash-lite'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CampoExtraccion {
  slug: string
  label: string
  tipo: 'texto' | 'numero' | 'currency' | 'fecha' | 'boolean'
  required: boolean
  descripcion_ai: string  // le dice a Gemini qué buscar
  /** Si true, la UI muestra una alerta "Revisar" junto al campo: la IA no es
   *  100% confiable en este dato y debe validarse a mano (ej. ciudad de venta). */
  alerta_revision?: boolean
  /** Normalización determinista aplicada al valor extraído antes de persistir.
   *  - `nit_sin_dv`: deja el NIT base sin el dígito de verificación pegado
   *    (ej. "8600190638" → "860019063"). Lo que se keyea a la DIAN va sin DV;
   *    la Relación de facturas lo reformatea con guion al renderizar. */
  normalizar?: 'nit_sin_dv'
}

export interface CampoResultado {
  value: string | null
  confidence: number  // 0.0 - 1.0
  manual: boolean     // true si confidence < 0.70
}

// ── Supported MIME types ─────────────────────────────────────────────────────

const SUPPORTED_MIMES: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
}

// ── JSON repair (copied from parse-ve-docs.ts) ──────────────────────────────

function repairJson(text: string): string {
  let s = text
    .replace(/^\uFEFF/, '')                       // BOM
    .replace(/^```(?:json)?\s*/i, '')             // opening fence
    .replace(/\s*```\s*$/, '')                    // closing fence
    .trim()

  const braceStart = s.indexOf('{')
  const braceEnd = s.lastIndexOf('}')
  if (braceStart >= 0 && braceEnd > braceStart) {
    s = s.slice(braceStart, braceEnd + 1)
  }

  s = s.replace(/\bNone\b/g, 'null')
  s = s.replace(/\bTrue\b/g, '"true"')
  s = s.replace(/\bFalse\b/g, '"false"')

  s = s.replace(/("(?:[^"\\]|\\.)*")/g, (match) =>
    match.replace(/\r?\n/g, ' ').replace(/\t/g, ' ')
  )

  s = s.replace(/,\s*([}\]])/g, '$1')

  return s
}

// ── Build dynamic prompt ─────────────────────────────────────────────────────

function buildPrompt(campos: CampoExtraccion[]): string {
  const fieldList = campos
    .map((c, i) => `${i + 1}. ${c.slug} (${c.label}): ${c.descripcion_ai}`)
    .join('\n')

  return `Eres un extractor de datos de documentos.

Tu trabajo: recibir un documento y extraer campos específicos en JSON.

CAMPOS A EXTRAER:

${fieldList}

REGLAS:
- Responde SOLO con JSON válido, sin texto adicional
- Para cada campo devuelve { "value": <valor>, "confidence": <0.0 a 1.0> }
- Si un campo no está en el documento, usa { "value": null, "confidence": 0.0 }
- confidence refleja certeza de lectura (1.0 = perfectamente legible, 0.5 = borroso pero probable, 0.0 = no visible)
- Limpia valores: sin espacios al inicio/final
- Números de identificación y códigos: solo dígitos, sin puntos, guiones ni espacios
- MONEDA COLOMBIANA (campos tipo currency): los valores monetarios están en pesos colombianos (COP). El separador de miles es el punto (.) y el separador decimal es la coma (,). Ejemplo: $1.500.000 = un millón quinientos mil. Devuelve SOLO el valor numérico entero sin puntos, comas ni símbolo $. Ejemplo: si ves "$1.500.000" o "1.500.000,00", devuelve "1500000"
- Campos tipo numero (no currency): devuelve el número tal cual, sin formato de moneda

FORMATO DE RESPUESTA (JSON con los slugs como keys):
{
${campos.map(c => `  "${c.slug}": { "value": "...", "confidence": 0.95 }`).join(',\n')}
}`
}

// ── Main extractor ───────────────────────────────────────────────────────────

/**
 * Extract configurable fields from a document using Gemini 2.5 Flash.
 *
 * IMPORTANT: apiKey must be passed from the server action caller
 * (process.env is not reliably available in library files on Vercel).
 */
export async function extractFieldsFromDocument(
  buffer: Buffer,
  mimeType: string,
  campos: CampoExtraccion[],
  apiKey: string,
): Promise<{ data: Record<string, CampoResultado> | null; error?: string }> {
  if (!apiKey) {
    return { data: null, error: 'GEMINI_API_KEY no configurada en el servidor' }
  }

  if (campos.length === 0) {
    return { data: null, error: 'No se proporcionaron campos para extraer' }
  }

  const normalizedMime = SUPPORTED_MIMES[mimeType.toLowerCase()]
  if (!normalizedMime) {
    return { data: null, error: `Tipo MIME no soportado: ${mimeType}` }
  }

  const base64 = buffer.toString('base64')
  const systemPrompt = buildPrompt(campos)

  // Forzar JSON estructurado válido vía responseSchema (evita que Gemini devuelva
  // JSON malformado — comas faltantes, comillas sin escapar, etc. que rompían el parser).
  const responseSchema = {
    type: 'OBJECT',
    properties: Object.fromEntries(campos.map(c => [c.slug, {
      type: 'OBJECT',
      properties: { value: { type: 'STRING' }, confidence: { type: 'NUMBER' } },
      required: ['value', 'confidence'],
    }])),
    required: campos.map(c => c.slug),
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  let debugRaw = ''
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            parts: [
              { text: 'Extrae los datos del siguiente documento.' },
              { inline_data: { mime_type: normalizedMime, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          // Documentos con muchos campos (RUT = 20+) desbordaban el presupuesto:
          // el "thinking" del modelo consume maxOutputTokens y dejaba la
          // respuesta SIN la parte JSON (finishReason MAX_TOKENS) → el parser caía
          // en texto de razonamiento truncado ("position 120"). Desactivamos
          // thinking (la extracción es determinista, no lo necesita) y subimos el
          // límite → todo el presupuesto va al JSON estructurado.
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`[extract-fields] Gemini HTTP error: ${res.status} — ${errBody.slice(0, 500)}`)
      return { data: null, error: `Error de Gemini (${res.status})` }
    }

    const data = await res.json()

    const blockReason = data.promptFeedback?.blockReason
    if (blockReason) {
      return { data: null, error: `Contenido bloqueado por Gemini: ${blockReason}` }
    }

    const candidate = data.candidates?.[0]
    const finishReason = candidate?.finishReason
    const parts = candidate?.content?.parts || []
    // Preferir la parte de texto que parezca JSON (empieza con '{'); evita caer en
    // una parte de "thought"/prosa si el modelo emitiera ambas.
    const jsonPart =
      parts.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text?.trim().startsWith('{'))
      || parts.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text)
      || parts[parts.length - 1]

    debugRaw = jsonPart?.text || ''
    if (!debugRaw) {
      return {
        data: null,
        error: finishReason === 'MAX_TOKENS'
          ? 'Gemini agotó el límite de tokens sin devolver JSON (documento muy grande)'
          : 'Gemini no devolvió respuesta',
      }
    }

    // Parse JSON with repair fallback
    let raw: Record<string, { value: string | null; confidence: number }>
    try {
      raw = JSON.parse(debugRaw)
    } catch {
      console.warn('[extract-fields] Direct parse failed, attempting repair...')
      const repaired = repairJson(debugRaw)
      try {
        raw = JSON.parse(repaired)
      } catch (e2) {
        console.error('[extract-fields] Repair also failed. Raw:', debugRaw.slice(0, 600))
        throw new Error(`JSON inválido de Gemini: ${String(e2).slice(0, 80)}`)
      }
    }

    // Build result with confidence tiers
    const result: Record<string, CampoResultado> = {}
    for (const campo of campos) {
      const field = raw[campo.slug]
      if (!field || field.value === undefined) {
        result[campo.slug] = { value: null, confidence: 0, manual: true }
        continue
      }

      let value = field.value !== null ? String(field.value).trim() || null : null
      const confidence = field.confidence ?? 0

      // Post-process currency fields: strip currency symbols and separators
      if (value && campo.tipo === 'currency') {
        // Remove $, spaces, dots (thousand sep in COP), then treat comma as decimal
        let cleaned = value.replace(/[$\s]/g, '')
        // If contains dots and comma: "1.500.000,50" → remove dots, replace comma with dot
        if (cleaned.includes('.') && cleaned.includes(',')) {
          cleaned = cleaned.replace(/\./g, '').replace(',', '.')
        }
        // If contains only dots: "1.500.000" → thousand separators, remove them
        else if ((cleaned.match(/\./g) || []).length > 1) {
          cleaned = cleaned.replace(/\./g, '')
        }
        // If contains single dot: could be decimal "1500.50" or thousand "1.500"
        // Heuristic: if exactly 3 digits after dot, it's a thousand separator in COP context
        else if (cleaned.includes('.')) {
          const afterDot = cleaned.split('.')[1]
          if (afterDot && afterDot.length === 3) {
            cleaned = cleaned.replace('.', '') // thousand separator
          }
          // else leave as decimal
        }
        // If contains only comma: "1500,50" → decimal separator
        else if (cleaned.includes(',')) {
          cleaned = cleaned.replace(',', '.')
        }
        // Round to integer for COP (no cents)
        const num = parseFloat(cleaned)
        if (!isNaN(num)) {
          value = String(Math.round(num))
        }
      }

      // Confidence < 0.70 → manual required, value forced to null
      if (confidence < 0.70) {
        result[campo.slug] = { value: null, confidence, manual: true }
      } else {
        result[campo.slug] = { value, confidence, manual: false }
      }
    }

    return { data: result }
  } catch (err) {
    console.error('[extract-fields] Exception:', err, '\n[extract-fields] Raw:', debugRaw.slice(0, 800))
    return { data: null, error: `Error procesando documento: ${String(err).slice(0, 120)}` }
  }
}
