// ============================================================
// Audio Transcription — Download from Meta + Gemini 2.0 Flash
// ============================================================

const META_API_VERSION = 'v21.0';
const GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * Download WhatsApp audio message and transcribe with Gemini.
 * Returns transcribed text or null if transcription fails.
 */
export async function transcribeAudio(audioId: string): Promise<string | null> {
  try {
    // 1. Get download URL from Meta
    const mediaUrl = await getMediaUrl(audioId);
    if (!mediaUrl) {
      console.error('[wa-transcribe] Failed to get media URL');
      return null;
    }

    // 2. Download audio binary
    const audioData = await downloadMedia(mediaUrl);
    if (!audioData) {
      console.error('[wa-transcribe] Failed to download media');
      return null;
    }

    // 3. Transcribe with Gemini
    const text = await geminiTranscribe(audioData.base64, audioData.mimeType);
    if (!text) {
      console.error('[wa-transcribe] Gemini transcription failed');
      return null;
    }

    console.log(`[wa-transcribe] OK (${audioData.mimeType}): "${text.slice(0, 100)}"`);
    return text;
  } catch (err) {
    console.error('[wa-transcribe] Error:', err);
    return null;
  }
}

// ============================================================
// Meta Media Download
// ============================================================

async function getMediaUrl(mediaId: string): Promise<string | null> {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  if (!token) return null;

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    console.error(`[wa-transcribe] Meta media GET failed: ${res.status}`);
    return null;
  }

  const data = await res.json();
  return data.url || null;
}

async function downloadMedia(
  url: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  if (!token) return null;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error(`[wa-transcribe] Media download failed: ${res.status}`);
    return null;
  }

  const mimeType = res.headers.get('content-type') || 'audio/ogg';
  const buffer = new Uint8Array(await res.arrayBuffer());
  const base64 = uint8ToBase64(buffer);

  return { base64, mimeType };
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
): Promise<string | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

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
    const err = await res.text();
    console.error(`[wa-transcribe] Gemini error: ${res.status} — ${err}`);
    return null;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!text || text === 'INAUDIBLE') return null;
  return text;
}
