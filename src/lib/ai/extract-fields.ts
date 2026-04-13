// ============================================================
// Generic AI Field Extractor — Gemini 2.5 Flash
// Extrae campos configurables de cualquier documento.
// Pattern: parse-ve-docs.ts (inline_data base64, structured output)
// ============================================================

const GEMINI_MODEL = 'gemini-2.5-flash'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CampoExtraccion {
  slug: string
  label: string
  tipo: 'texto' | 'numero' | 'fecha' | 'boolean'
  required: boolean
  descripcion_ai: string  // le dice a Gemini qué buscar
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
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
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

    // Gemini 2.5 Flash has built-in thinking — response may have multiple parts
    const parts = data.candidates?.[0]?.content?.parts || []
    const jsonPart = parts.find(
      (p: { thought?: boolean; text?: string }) => !p.thought && p.text
    ) || parts[parts.length - 1]

    debugRaw = jsonPart?.text || ''
    if (!debugRaw) {
      return { data: null, error: 'Gemini no devolvió respuesta' }
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

      const value = field.value !== null ? String(field.value).trim() || null : null
      const confidence = field.confidence ?? 0

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
