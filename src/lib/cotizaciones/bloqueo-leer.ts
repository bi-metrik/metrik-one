import 'server-only'

import { fetchModeloDocumentos } from '@/lib/ai/modelo-llm'
import { extraerConReintento, type ResultadoExtraccion } from '@/lib/ai/reintentar-extraccion'
import { getServerKey } from '@/lib/server-keys'
import { huellaDeImagen } from './captura-repetida'
import {
  ESQUEMA_HOTEL_BLOQUEO,
  ESQUEMA_VUELO_BLOQUEO,
  PROMPT_HOTEL_BLOQUEO,
  PROMPT_VUELO_BLOQUEO,
  hotelDesdeLectura,
  vueloDesdeLectura,
} from './bloqueo-extraccion'
import type { HotelBloqueo, IncluyeBloqueo, VueloBloqueo } from './bloqueo-paquete'

/**
 * La lectura de los dos pantallazos de un paquete de bloqueo, SIN escribir nada (la escritura es de
 * `guardarPaqueteBloqueo`, después de que la asesora revisa y corrige). Una llamada por pantallazo, con
 * el mismo modelo, la misma puerta (`fetchModeloDocumentos`) y el mismo reintento que la lectura de
 * siempre (`extraer-ranura.ts`).
 *
 * Lo que devuelve el modelo pasa SIEMPRE por los saneadores puros de `bloqueo-extraccion.ts`: son los
 * que prueban los fixtures.
 */

const MODELO = 'gemini-2.5-flash'
const TIMEOUT_MS = 25_000
const MAX_OUTPUT_TOKENS = 8_192
const THINKING_BUDGET = 1024

const MIMES: Record<string, string> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/webp': 'image/webp',
}

export type LecturaBloqueo =
  | { ok: true; cual: 'hotel'; hotel: HotelBloqueo; incluye: IncluyeBloqueo; huella: string | null }
  | { ok: true; cual: 'vuelo'; vuelo: VueloBloqueo; huella: string | null }
  | { ok: false; mensaje: string; detalle?: string }

async function unaLlamada(base64: string, mime: string, prompt: string, esquema: unknown, apiKey: string): Promise<ResultadoExtraccion<unknown>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${apiKey}`
  try {
    const res = await fetchModeloDocumentos(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: prompt }] },
        contents: [{ parts: [{ text: 'Lee el siguiente pantallazo.' }, { inline_data: { mime_type: mime, data: base64 } }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
          responseSchema: esquema,
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        },
      }),
    })
    if (!res.ok) return { data: null, error: `Error del modelo (${res.status})` }
    const data = await res.json()
    const bloqueo = data.promptFeedback?.blockReason
    if (bloqueo) return { data: null, error: `Contenido bloqueado: ${bloqueo}` }
    const candidato = data.candidates?.[0]
    if (candidato?.finishReason && candidato.finishReason !== 'STOP') {
      return { data: null, error: `La lectura terminó con motivo ${candidato.finishReason}` }
    }
    const texto: string = (candidato?.content?.parts ?? [])
      .find((p: { thought?: boolean; text?: string }) => !p.thought && p.text)?.text ?? ''
    return { data: JSON.parse(texto) }
  } catch (err) {
    return { data: null, error: String(err).slice(0, 160) }
  }
}

export async function leerPantallazoDeBloqueo(cual: 'hotel' | 'vuelo', dataUrl: string): Promise<LecturaBloqueo> {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl ?? '')
  const mime = m ? MIMES[m[1].toLowerCase()] : undefined
  if (!m || !mime) return { ok: false, mensaje: 'La imagen no llegó en un formato legible (PNG, JPG o WEBP). Vuelve a pegarla.' }
  const apiKey = getServerKey('gemini')
  if (!apiKey) return { ok: false, mensaje: 'Falta configurar la lectura de capturas. Avísale a MeTRIK.' }

  const [lectura, huella] = await Promise.all([
    extraerConReintento(
      () => unaLlamada(m[2].trim(), mime, cual === 'hotel' ? PROMPT_HOTEL_BLOQUEO : PROMPT_VUELO_BLOQUEO, cual === 'hotel' ? ESQUEMA_HOTEL_BLOQUEO : ESQUEMA_VUELO_BLOQUEO, apiKey),
      `bloqueo:${cual}`,
    ),
    huellaDeImagen(dataUrl),
  ])
  if (!lectura.data) return { ok: false, mensaje: 'No se pudo leer el pantallazo. Vuelve a intentarlo o escribe los datos a mano.', detalle: lectura.error }

  if (cual === 'hotel') {
    const h = hotelDesdeLectura(lectura.data)
    return h.ok ? { ok: true, cual, hotel: h.hotel, incluye: h.incluye, huella } : { ok: false, mensaje: h.motivo }
  }
  const v = vueloDesdeLectura(lectura.data)
  return v.ok ? { ok: true, cual, vuelo: v.vuelo, huella } : { ok: false, mensaje: v.motivo }
}
