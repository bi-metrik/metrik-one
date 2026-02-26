// ============================================================
// Audio Transcription — Download from Meta + Gemini 2.0 Flash
// ============================================================

import { getMediaUrl, downloadMediaBinary } from './wa-media.ts';

const GEMINI_MODEL = 'gemini-2.5-flash';

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
 * Download WhatsApp audio message and transcribe with Gemini.
 * Returns transcribed text or null if transcription fails, with error detail.
 */
export async function transcribeAudio(audioId: string): Promise<TranscribeResult> {
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
    const result = await geminiTranscribe(base64, mimeType);
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
): Promise<TranscribeResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    console.error('[wa-transcribe] GEMINI_API_KEY not set');
    return { text: null, error: 'GEMINI_NO_KEY: API key no configurada' };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  console.log(`[wa-transcribe] Calling Gemini with mime_type=${mimeType}, base64 length=${base64Audio.length}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: 'Transcribe este audio de WhatsApp. Es un profesional independiente colombiano hablando sobre su negocio (gastos, horas, cobros, proyectos, clientes). Responde SOLO con la transcripción textual del audio, sin explicaciones, sin comillas, sin formato adicional. Si el audio es inaudible o vacío, responde INAUDIBLE.',
            },
            {
              inline_data: { mime_type: mimeType, data: base64Audio },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
      },
    }),
  });

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
  if (finishReason && finishReason !== 'STOP') {
    console.warn(`[wa-transcribe] Gemini finishReason: ${finishReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  console.log(`[wa-transcribe] Gemini raw response: "${(text || '(empty)').slice(0, 150)}"`);

  if (!text || text === 'INAUDIBLE') {
    return { text: null, error: `GEMINI_RESULT: ${text || '(empty response)'}` };
  }
  return { text };
}
