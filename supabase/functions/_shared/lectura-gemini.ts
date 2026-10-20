// ============================================================
// La llamada al modelo de entendimiento (Gemini), sin `Deno` ni `process`
// ------------------------------------------------------------
// La usan los dos lados con el MISMO pedido: el bot (`wa-entendimiento.ts`, `leerConModelo`, en Deno) y la app
// cuando una comercial pega una conversación en el viaje (`src/lib/negocios/pegar-conversacion-servidor.ts`, en Next).
// Cada lado pone su llave y su modelo; el pedido, la verificación del motivo de terminación y el JSON son uno solo.
// Es pura salvo por `fetch` (inyectable para las pruebas).
// ============================================================

import { fetchModelo } from './llm-anthropic.ts';

/**
 * El modelo cuando no hay secreto que diga otro. Producción del bot lo fija con `GEMINI_ENTENDIMIENTO_MODEL` (Supabase,
 * 2026-10: `gemini-3.5-flash-lite`); la app lee la variable del mismo nombre en Vercel y, sin ella, cae aquí.
 */
export const MODELO_ENTENDIMIENTO_POR_DEFECTO = 'gemini-3.5-flash-lite';

export interface Lectura { json: unknown | null; finishReason: string | null; error: string | null }

/**
 * Llama al modelo con el esquema dado. Verifica el MOTIVO DE TERMINACIÓN, no solo que haya texto: media respuesta
 * aceptada en silencio es un falso verde (§3 del diseño). Nunca lanza.
 */
export async function leerConGemini(p: {
  apiKey: string | null | undefined;
  modelo: string;
  instrucciones: string;
  texto: string;
  esquema: unknown;
  fetch?: typeof fetch;
}): Promise<Lectura> {
  if (!p.apiKey) return { json: null, finishReason: null, error: 'GEMINI_NO_KEY' };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${p.modelo}:generateContent?key=${p.apiKey}`;
  const f = p.fetch ?? fetchModelo;
  try {
    const res = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: p.instrucciones }] },
        contents: [{ role: 'user', parts: [{ text: p.texto }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: p.esquema,
        },
      }),
    });
    if (!res.ok) return { json: null, finishReason: null, error: `GEMINI_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = await res.json();
    const bloqueo = data.promptFeedback?.blockReason;
    if (bloqueo) return { json: null, finishReason: null, error: `GEMINI_BLOCKED: ${bloqueo}` };
    const finishReason: string | null = data.candidates?.[0]?.finishReason ?? null;
    if (finishReason !== 'STOP') {
      return { json: null, finishReason, error: `GEMINI_INCOMPLETO: finishReason ${finishReason ?? '(ausente)'}` };
    }
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) return { json: null, finishReason, error: 'GEMINI_EMPTY' };
    try {
      return { json: JSON.parse(txt), finishReason, error: null };
    } catch {
      return { json: null, finishReason, error: 'GEMINI_JSON_INVALIDO' };
    }
  } catch (err) {
    return { json: null, finishReason: null, error: `GEMINI_RED: ${String(err).slice(0, 200)}` };
  }
}
