// ============================================================
// El texto del documento del cliente, redactado por Gemini (Trappvel)
//
// Patrón de src/lib/actas/generacion.ts: gemini-2.5-flash con thinking acotado (1024) y
// `responseSchema` para forzar JSON válido. La clave llega por parámetro desde la server
// action (`getServerKey('gemini')`): una lib no lee process.env.
//
// ⚠️ La firma es la que protege el dato: recibe SOLO `ViajeParaRedactar`, que se arma
// campo por campo en `documento-cliente.ts` sin el nombre del cliente ni precios. No
// acepta la cotización, el negocio ni las líneas: así esa regla no se puede romper por
// descuido desde quien llama. Lo único que entra aparte son los ejemplos de la voz de la
// agencia (`config_extra.ejemplos_texto` de la línea), que ya llegan limpios de cifras.
//
// Server-only. Nunca se llama al renderizar el PDF: solo desde el botón «Redactar con ONE».
// ============================================================

import {
  MODELO_REDACTOR,
  contenidoDelRedactor,
  promptDelRedactor,
  textoDelModelo,
  textoVacio,
  type TextoCliente,
  type ViajeParaRedactar,
} from '@/lib/cotizaciones/documento-cliente'

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    titular: { type: 'STRING' },
    intro: { type: 'STRING' },
    incluye: { type: 'ARRAY', items: { type: 'STRING' } },
    antes_de_viajar: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['titular', 'intro', 'incluye', 'antes_de_viajar'],
}

// Cortar del primer `{` al último `}` ya descarta cercas de código, un BOM o un preámbulo.
function repararJson(text: string): string {
  let s = text.trim()
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  return s.replace(/,\s*([}\]])/g, '$1')
}

/**
 * Redacta el texto. Lanza si no hay clave, si Gemini rechaza la llamada, si corta la
 * respuesta o si no devuelve nada utilizable: quien llama decide qué decirle a la persona.
 */
export async function redactarTextoCliente(
  viaje: ViajeParaRedactar,
  apiKey: string,
  opciones?: { ejemplos?: readonly TextoCliente[] },
): Promise<{ texto: TextoCliente; modelo: string }> {
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada en el servidor')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_REDACTOR}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: promptDelRedactor(opciones?.ejemplos ?? []) }] },
      contents: [{ parts: [{ text: contenidoDelRedactor(viaje) }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 1024 },
      },
    }),
  })

  if (!res.ok) {
    const cuerpo = await res.text()
    throw new Error(`Error de Gemini (${res.status}): ${cuerpo.slice(0, 300)}`)
  }

  const data = await res.json()
  const bloqueo = data.promptFeedback?.blockReason
  if (bloqueo) throw new Error(`Contenido bloqueado por Gemini: ${bloqueo}`)

  const candidato = data.candidates?.[0]
  // ⚠️ Una respuesta cortada no es una respuesta corta: con MAX_TOKENS la lista de
  // «incluye» puede llegar a medias y leerse como completa.
  if (candidato?.finishReason && candidato.finishReason !== 'STOP') {
    throw new Error(`Gemini no terminó la respuesta (${candidato.finishReason})`)
  }
  const partes: { thought?: boolean; text?: string }[] = candidato?.content?.parts ?? []
  const parte =
    partes.find(p => !p.thought && p.text?.trim().startsWith('{')) ??
    partes.find(p => !p.thought && p.text) ??
    partes[partes.length - 1]
  const crudo = parte?.text ?? ''
  if (!crudo) throw new Error('Gemini no devolvió respuesta')

  let json: unknown
  try {
    json = JSON.parse(crudo)
  } catch {
    try {
      json = JSON.parse(repararJson(crudo))
    } catch (e) {
      throw new Error(`JSON inválido de Gemini: ${String(e).slice(0, 120)}`)
    }
  }

  const texto = textoDelModelo(json)
  if (textoVacio(texto)) throw new Error('Gemini devolvió un texto vacío')
  return { texto, modelo: MODELO_REDACTOR }
}
