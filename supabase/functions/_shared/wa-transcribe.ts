// ============================================================
// Audio Transcription — Download from Meta + Gemini (Flash-Lite default)
// ============================================================

import { getMediaUrl, downloadMediaBinary } from './wa-media.ts';
import { PROMPT_TRANSCRIPCION_LITERAL, pedidoTranscripcion, promptConPistas } from './transcripcion.ts';

export { PROMPT_TRANSCRIPCION_LITERAL };

// Sprint 2 (Yuto): default to Flash-Lite (3.3x cheaper audio input, still multimodal).
// Override with GEMINI_AUDIO_MODEL env var for instant rollback to flash.
const GEMINI_MODEL = Deno.env.get('GEMINI_AUDIO_MODEL') || 'gemini-2.5-flash-lite';

// WhatsApp sends audio/ogg; codecs=opus — normalize to base mime
function normalizeAudioMimeType(raw: string): string {
  const base = raw.split(';')[0].trim().toLowerCase();
  // Map WhatsApp audio types to Gemini-supported types
  const mimeMap: Record<string, string> = {
    'audio/ogg': 'audio/ogg',
    'audio/oga': 'audio/ogg',
    'audio/opus': 'audio/opus',
    'audio/mp4': 'audio/mp4',
    'audio/mpeg': 'audio/mpeg',
    'audio/mp3': 'audio/mp3',
    'audio/wav': 'audio/wav',
    'audio/webm': 'audio/webm',
    'audio/aac': 'audio/aac',
    'audio/amr': 'audio/amr',
  };
  return mimeMap[base] || 'audio/ogg'; // default for WhatsApp
}

/** Result of transcription attempt — includes error detail for debugging */
export interface TranscribeResult {
  text: string | null;
  error?: string;
}

/**
 * Opciones de transcripcion. Sin ellas, la salida es amplia y un corte se rechaza.
 *
 * Antes el valor por defecto era 512 tokens de salida y un corte con `finishReason` distinto de
 * STOP solo se registraba como aviso: una nota de voz larga llegaba a medias al bot de atencion,
 * a la ruta de respaldo y a Cardumen sin que nadie lo supiera. Media transcripcion aceptada en
 * silencio es un falso verde (motor-solicitud-viaje.md, §3), asi que ahora es el comportamiento
 * por defecto para todas las rutas, no algo que cada una deba acordarse de pedir.
 */
export const MAX_SALIDA_TRANSCRIPCION = 8192;

export interface OpcionesTranscripcion {
  prompt?: string;
  /** Por defecto `MAX_SALIDA_TRANSCRIPCION`. */
  maxOutputTokens?: number;
  /** Por defecto true: un corte devuelve error, no texto. */
  exigirFinCompleto?: boolean;
  /**
   * El bloque «Palabras que pueden aparecer» (spec 2026-10-26, §4.6), armado por `textoPistas` (`agente/pistas.ts`)
   * con la base del workspace. Ausente o vacío = el prompt de siempre, sin un carácter de diferencia.
   */
  pistas?: string | null;
}

/**
 * Download WhatsApp audio message and transcribe with Gemini.
 * Returns transcribed text or null if transcription fails, with error detail.
 */
export async function transcribeAudio(audioId: string, opciones: OpcionesTranscripcion = {}): Promise<TranscribeResult> {
  try {
    console.log(`[wa-transcribe] Starting transcription for audio: ${audioId}`);

    // 1. Get download URL from Meta
    const mediaUrl = await getMediaUrl(audioId);
    if (!mediaUrl) {
      return { text: null, error: 'META_URL_FAIL: No pude obtener URL del audio de Meta' };
    }
    console.log(`[wa-transcribe] Got media URL (${mediaUrl.slice(0, 80)}...)`);

    // 2. Download audio binary
    const audioData = await downloadMediaBinary(mediaUrl);
    if (!audioData) {
      return { text: null, error: 'META_DOWNLOAD_FAIL: No pude descargar el audio' };
    }
    const mimeType = normalizeAudioMimeType(audioData.rawMimeType);
    const base64 = uint8ToBase64(audioData.buffer);
    console.log(`[wa-transcribe] Downloaded ${audioData.sizeKB}KB, raw mime: "${audioData.rawMimeType}", normalized: "${mimeType}"`);

    // 3. Transcribe with Gemini
    const result = await geminiTranscribe(base64, mimeType, opciones);
    if (!result.text) {
      return { text: null, error: result.error || 'GEMINI_EMPTY: Gemini no devolvió texto' };
    }

    console.log(`[wa-transcribe] OK: "${result.text.slice(0, 100)}"`);
    return { text: result.text };
  } catch (err) {
    console.error('[wa-transcribe] Unhandled error:', err);
    return { text: null, error: `EXCEPTION: ${String(err).slice(0, 200)}` };
  }
}

/** Convert Uint8Array to base64 in chunks to avoid call stack overflow */
function uint8ToBase64(buffer: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
    const chunk = buffer.subarray(i, Math.min(i + CHUNK_SIZE, buffer.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// ============================================================
// Gemini Transcription
// ============================================================

async function geminiTranscribe(
  base64Audio: string,
  mimeType: string,
  opciones: OpcionesTranscripcion = {},
): Promise<TranscribeResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    console.error('[wa-transcribe] GEMINI_API_KEY not set');
    return { text: null, error: 'GEMINI_NO_KEY: API key no configurada' };
  }

  // Se queda en Gemini a propósito (migración a Claude Haiku 5.5, 2026-10-20): Haiku 5.5 no recibe audio, y no hay
  // otro proveedor de voz a texto aprobado. Por eso usa el fetch de siempre y no `fetchModelo` (_shared/llm-anthropic.ts).
  // La llave va en la cabecera `x-goog-api-key` (2026-10-26), no en la URL: así no queda en ningún log de la URL.
  const prompt = opciones.prompt ?? 'Transcribe este audio de WhatsApp. Es un profesional independiente colombiano registrando movimientos de sus negocios (gastos, horas, cobros, clientes, etapas de venta y ejecución). Responde SOLO con la transcripción textual del audio, sin explicaciones, sin comillas, sin formato adicional. Si el audio es inaudible o vacío, responde INAUDIBLE.';
  const { url, init } = pedidoTranscripcion({
    modelo: GEMINI_MODEL,
    llave: apiKey,
    prompt: promptConPistas(prompt, opciones.pistas),
    mime: mimeType,
    base64: base64Audio,
    maxSalida: opciones.maxOutputTokens ?? MAX_SALIDA_TRANSCRIPCION,
    temperatura: 0.1,
  });

  console.log(`[wa-transcribe] Calling Gemini with mime_type=${mimeType}, base64 length=${base64Audio.length}${opciones.pistas ? ', con pistas' : ''}`);

  const res = await fetch(url, init);

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[wa-transcribe] Gemini HTTP error: ${res.status} — ${errBody.slice(0, 500)}`);
    return { text: null, error: `GEMINI_HTTP_${res.status}: ${errBody.slice(0, 150)}` };
  }

  const data = await res.json();

  // Check for blocked content
  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason) {
    console.error(`[wa-transcribe] Gemini blocked: ${blockReason}`);
    return { text: null, error: `GEMINI_BLOCKED: ${blockReason}` };
  }

  const finishReason = data.candidates?.[0]?.finishReason;
  if (finishReason !== 'STOP') {
    console.warn(`[wa-transcribe] Gemini finishReason: ${finishReason ?? '(ausente)'}`);
    if (opciones.exigirFinCompleto ?? true) {
      return { text: null, error: `GEMINI_INCOMPLETO: finishReason ${finishReason ?? '(ausente)'}` };
    }
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  console.log(`[wa-transcribe] Gemini raw response: "${(text || '(empty)').slice(0, 150)}"`);

  if (!text || text === 'INAUDIBLE') {
    return { text: null, error: `GEMINI_RESULT: ${text || '(empty response)'}` };
  }
  return { text };
}
