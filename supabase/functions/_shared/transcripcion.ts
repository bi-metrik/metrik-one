// ============================================================
// Transcripción de notas de voz con Gemini — las piezas puras (spec 2026-10-26, §4.6)
// ------------------------------------------------------------
// Lo comparten `wa-transcribe.ts` (ONE, la bandeja y el bot de siempre), `agente/publico/transcribir.ts` (Chatwoot) y
// el arnés de audios (`agente/arnes/audios/`), para que la prueba arme EXACTAMENTE el mismo pedido que producción.
//   · `promptConPistas`: sin pistas devuelve el prompt tal cual (el interruptor apagado no cambia ni un carácter).
//   · `pedidoTranscripcion`: la llave va en la cabecera `x-goog-api-key`, nunca en la URL, para que no quede en los
//     logs de quien registre la URL. Doc oficial: https://ai.google.dev/gemini-api/docs/api-key (ejemplo REST con
//     `-H "x-goog-api-key: …"`), leída el 2026-10-26.
// Sin `Deno` ni red: se prueba en vitest.
// ============================================================

export const URL_GEMINI_MODELOS = 'https://generativelanguage.googleapis.com/v1beta/models';

/** El modelo de audio de ONE y la bandeja si no se fija `GEMINI_AUDIO_MODEL` (Sprint 2, Yuto: Flash-Lite). */
export const MODELO_AUDIO_ONE = 'gemini-2.5-flash-lite';

/** Prompt neutro: no presupone gastos ni ningun tema. */
export const PROMPT_TRANSCRIPCION_LITERAL =
  'Transcribe este audio de WhatsApp en espanol, palabra por palabra. Responde SOLO con la transcripcion textual, sin explicaciones, sin comillas, sin resumir y sin formato adicional. Si el audio es inaudible o vacio, responde INAUDIBLE.';

/**
 * El prompt con el bloque de pistas al final. `pistas` vacías o nulas = el prompt intacto. El bloque lo arma
 * `textoPistas` (`agente/pistas.ts`); aquí solo se pega. Pura.
 */
export function promptConPistas(prompt: string, pistas: string | null | undefined): string {
  const p = (pistas ?? '').trim();
  return p ? `${prompt}\n\n${p}` : prompt;
}

export interface PedidoTranscripcion {
  modelo: string;
  llave: string;
  prompt: string;
  mime: string;
  base64: string;
  maxSalida: number;
  /** `null` = la del proveedor (público no la fija). */
  temperatura: number | null;
}

/**
 * El texto de la respuesta de `generateContent`, con las reglas de producción: un bloqueo, un corte (finishReason
 * distinto de STOP), una respuesta vacía o INAUDIBLE no son texto. Pura.
 */
export function textoDeRespuesta(d: unknown): { texto: string } | { error: string } {
  const r = d as { promptFeedback?: { blockReason?: string }; candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }> };
  if (r?.promptFeedback?.blockReason) return { error: `GEMINI_BLOCKED: ${r.promptFeedback.blockReason}` };
  const fin = r?.candidates?.[0]?.finishReason;
  if (fin !== 'STOP') return { error: `GEMINI_INCOMPLETO: finishReason ${fin ?? '(ausente)'}` };
  const texto = (r?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? '').join('').trim();
  if (!texto || texto === 'INAUDIBLE') return { error: `GEMINI_RESULT: ${texto || '(empty response)'}` };
  return { texto };
}

/** La URL y el `RequestInit` de `generateContent` con el audio en línea. La llave, solo en la cabecera. Pura. */
export function pedidoTranscripcion(p: PedidoTranscripcion): { url: string; init: RequestInit } {
  const generationConfig: Record<string, number> = {};
  if (p.temperatura !== null) generationConfig.temperature = p.temperatura;
  generationConfig.maxOutputTokens = p.maxSalida;
  return {
    url: `${URL_GEMINI_MODELOS}/${p.modelo}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.llave },
      body: JSON.stringify({
        contents: [{ parts: [{ text: p.prompt }, { inline_data: { mime_type: p.mime, data: p.base64 } }] }],
        generationConfig,
      }),
    },
  };
}
