// ============================================================
// Lector de tipo de documento — Gemini 2.5 Flash
// Mira un archivo y dice QUÉ DOCUMENTO ES, sin saber qué se esperaba.
// ============================================================
//
// ⚠️ **Es una llamada aparte de `extract-fields`, y eso es la mitad del diseño.**
// La extracción recibe la lista de campos del bloque, o sea que ya sabe qué documento se
// supone que está leyendo: pedirle en la misma llamada «y además dime qué documento es»
// la ancla — el modelo acaba de decir que encontró el NIT, la razón social y la dirección,
// así que confirma «RUT». Este lector recibe SOLO el archivo y el catálogo completo, y por
// eso su respuesta vale como control.
//
// Cuesta una llamada más, y solo en los bloques que declaran `documento_esperado`. Los
// demás no pasan por aquí: ni una llamada, ni un token, ni un cambio de comportamiento.

import {
  TIPOS_DOCUMENTO,
  TIPO_ILEGIBLE,
  TIPO_OTRO,
  VALORES_RECONOCIBLES,
  type Reconocimiento,
  type TipoReconocido,
} from '@/lib/documentos/tipo-documento'

const GEMINI_MODEL = 'gemini-2.5-flash'

const SUPPORTED_MIMES: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
}

function catalogoEnPrompt(): string {
  const filas = Object.entries(TIPOS_DOCUMENTO)
    .map(([slug, d]) => `- ${slug}: ${d.label}. ${d.descripcion}`)
    .join('\n')
  return (
    `${filas}\n` +
    `- ${TIPO_OTRO}: es un documento legible, pero no es ninguno de los anteriores.\n` +
    `- ${TIPO_ILEGIBLE}: el archivo no se puede leer (en blanco, borroso, cortado o no es un documento).`
  )
}

const PROMPT = `Eres un clasificador de documentos colombianos.

Recibes UN archivo y dices qué documento es. No extraes datos: solo lo identificas.

TIPOS POSIBLES (elige exactamente uno):

${catalogoEnPrompt()}

REGLAS:
- Responde SOLO con JSON válido.
- "tipo": uno de los valores de la lista, tal cual (en minúsculas, con guion bajo).
- "confianza": 0.0 a 1.0. Es tu certeza sobre el TIPO, no sobre la calidad de la imagen. Usa 0.95 o más solo si el documento se identifica sin duda (por su encabezado, su logo, su numeración oficial o su fórmula de apertura).
- "evidencia": UNA frase corta (máximo 120 caracteres) con lo que viste que sustenta el tipo: el título del documento, la entidad que lo expide o el encabezado. En español, sin datos personales.
- Si el archivo trae varios documentos pegados, clasifica por el PRIMERO.
- Si dudas entre dos tipos, elige el más probable y baja la confianza. No inventes un tipo que no esté en la lista.

FORMATO:
{ "tipo": "...", "confianza": 0.0, "evidencia": "..." }`

const responseSchema = {
  type: 'OBJECT',
  properties: {
    tipo: { type: 'STRING', enum: VALORES_RECONOCIBLES as string[] },
    confianza: { type: 'NUMBER' },
    evidencia: { type: 'STRING' },
  },
  required: ['tipo', 'confianza', 'evidencia'],
}

/**
 * Identifica el documento de un archivo.
 *
 * Nunca lanza: devuelve `{ data: null, error }` y quien llama decide. Y quien llama
 * **deja pasar** cuando no hay respuesta — ver `veredictoDocumento`: un lector caído no
 * puede convertirse en un bloqueo para el operador.
 */
export async function reconocerDocumento(
  buffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<{ data: Reconocimiento | null; error?: string }> {
  if (!apiKey) return { data: null, error: 'GEMINI_API_KEY no configurada en el servidor' }

  const normalizedMime = SUPPORTED_MIMES[mimeType.toLowerCase()]
  if (!normalizedMime) return { data: null, error: `Tipo MIME no soportado: ${mimeType}` }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: PROMPT }] },
        contents: [
          {
            parts: [
              { text: 'Identifica el siguiente documento.' },
              { inline_data: { mime_type: normalizedMime, data: buffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          // Identificar un documento es una pregunta de una sola pasada, pero el
          // presupuesto de pensamiento se descuenta del de salida (ver el gotcha de
          // MAX_TOKENS en `extract-fields`): 512 de pensamiento y 2048 de techo dejan
          // sitio de sobra para un JSON de tres llaves.
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          responseSchema,
          thinkingConfig: { thinkingBudget: 512 },
        },
      }),
    })

    if (!res.ok) {
      const cuerpo = await res.text()
      console.error(`[reconocer-documento] Gemini HTTP ${res.status} — ${cuerpo.slice(0, 300)}`)
      return { data: null, error: `Error de Gemini (${res.status})` }
    }

    const json = await res.json()
    if (json.promptFeedback?.blockReason) {
      return { data: null, error: `Contenido bloqueado por Gemini: ${json.promptFeedback.blockReason}` }
    }

    const candidate = json.candidates?.[0]
    // ⚠️ Un `finishReason` distinto de STOP quiere decir que la respuesta se cortó:
    // media clasificación no se acepta como clasificación (misma regla que el
    // transcriptor de calidad, que ya pagó ese error).
    const finish = candidate?.finishReason
    if (finish && finish !== 'STOP') {
      return { data: null, error: `Gemini no terminó la respuesta (${finish})` }
    }

    const parts = (candidate?.content?.parts ?? []) as Array<{ thought?: boolean; text?: string }>
    const texto =
      parts.find(p => !p.thought && p.text?.trim().startsWith('{'))?.text ??
      parts.find(p => !p.thought && p.text)?.text ??
      ''
    if (!texto) return { data: null, error: 'Gemini no devolvió respuesta' }

    const crudo = JSON.parse(texto) as { tipo?: unknown; confianza?: unknown; evidencia?: unknown }
    if (typeof crudo.tipo !== 'string' || !VALORES_RECONOCIBLES.includes(crudo.tipo)) {
      // El `enum` del esquema debería impedirlo. Si igual llega algo fuera de la lista,
      // se trata como «no lo sé», nunca como un tipo inventado.
      return { data: null, error: `Gemini devolvió un tipo desconocido: ${String(crudo.tipo).slice(0, 40)}` }
    }

    const confianza = typeof crudo.confianza === 'number' && crudo.confianza >= 0 && crudo.confianza <= 1
      ? crudo.confianza
      : 0
    const evidencia = typeof crudo.evidencia === 'string' ? crudo.evidencia.trim().slice(0, 160) : ''

    return { data: { tipo: crudo.tipo as TipoReconocido, confianza, evidencia } }
  } catch (err) {
    console.error('[reconocer-documento] Excepción:', err)
    return { data: null, error: `Error identificando documento: ${String(err).slice(0, 120)}` }
  }
}
