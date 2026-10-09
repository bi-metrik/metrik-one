// ============================================================
// Arnés — el usuario simulado del conjunto 2 (como ADK, Decagon e Intercom)
// ------------------------------------------------------------
// Un comercial con un objetivo y una forma de hablar. Ve solo lo que vería en WhatsApp (sus mensajes y los del bot,
// con sus botones). Se escribió sin mirar las fichas de guía del reglamento, para no enseñarle las respuestas.
// Responde una acción por turno: escribir, reenviar el siguiente mensaje del cliente, tocar una opción o terminar.
// ============================================================

import type { UsoLlamado } from '../tipos.ts';

export type AccionSimulada = { accion: 'escribe' | 'reenvia' | 'toca' | 'fin'; texto: string };

export function promptSimulador(p: { objetivo: string; estilo: string; pendientes: number }): string {
  return [
    'Eres un comercial de una agencia de viajes en Colombia. Le escribes por WhatsApp a un asistente que te ayuda a dejar las solicitudes de tus clientes en el sistema de la agencia.',
    `Tu objetivo: ${p.objetivo}`,
    `Cómo hablas: ${p.estilo}`,
    p.pendientes ? `Tienes ${p.pendientes} mensaje(s) de tu cliente para reenviarle al asistente, en orden. Para reenviar el siguiente, usa la acción «reenvia» (el sistema lo reenvía tal cual).` : 'No tienes mensajes del cliente para reenviar.',
    'Una acción por turno. Si el asistente te muestra botones u opciones y quieres elegir una, usa «toca» con el título exacto de la opción. También puedes contestar escribiendo, como haría una persona.',
    'Cuando el asistente diga que ya hizo lo que querías, o si ya no avanza después de varios intentos, usa «fin». No inventes datos que no estén en tu objetivo.',
  ].join('\n');
}

export function transcripcionParaSimulador(lineas: Array<{ quien: 'tu' | 'asistente' | 'reenvio'; texto: string; opciones?: string[] }>): string {
  if (!lineas.length) return '(todavía no has escrito nada)';
  return lineas.map((l) => (l.quien === 'asistente'
    ? `Asistente: ${l.texto}${l.opciones?.length ? `\n  [opciones: ${l.opciones.join(' | ')}]` : ''}`
    : l.quien === 'reenvio' ? `Tú (reenviado del cliente): ${l.texto}` : `Tú: ${l.texto}`)).join('\n');
}

const ESQUEMA = {
  type: 'object',
  properties: { accion: { type: 'string', enum: ['escribe', 'reenvia', 'toca', 'fin'] }, texto: { type: 'string' } },
  required: ['accion', 'texto'],
};

export async function simular(
  o: { llave: string; modelo: string; razonamiento: string | null; sistema: string; transcripcion: string; fetch?: typeof fetch },
): Promise<{ ok: true; accion: AccionSimulada; uso: UsoLlamado } | { ok: false; motivo: string; uso: UsoLlamado }> {
  const t0 = performance.now();
  const f = o.fetch ?? fetch;
  const uso: UsoLlamado = { modelo: o.modelo, entrada: 0, salida: 0, razonamiento: 0, cache: 0, ms: 0, ok: false };
  try {
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${o.modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.llave },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: o.sistema }] },
        contents: [{ role: 'user', parts: [{ text: `La conversación hasta ahora:\n${o.transcripcion}\n\n¿Qué haces ahora?` }] }],
        generationConfig: {
          responseMimeType: 'application/json', responseSchema: ESQUEMA, maxOutputTokens: 1024,
          ...(o.razonamiento ? { thinkingConfig: { thinkingLevel: o.razonamiento } } : {}),
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    uso.ms = Math.round(performance.now() - t0);
    if (res.status !== 200) return { ok: false, motivo: `http ${res.status}: ${(await res.text()).slice(0, 160)}`, uso };
    const d = await res.json();
    const u = d?.usageMetadata ?? {};
    Object.assign(uso, { entrada: u.promptTokenCount ?? 0, salida: u.candidatesTokenCount ?? 0, razonamiento: u.thoughtsTokenCount ?? 0, cache: u.cachedContentTokenCount ?? 0, ok: true });
    const txt = d?.candidates?.[0]?.content?.parts?.find((p: { text?: string; thought?: boolean }) => p.text && !p.thought)?.text ?? '';
    const a = JSON.parse(txt) as AccionSimulada;
    if (!['escribe', 'reenvia', 'toca', 'fin'].includes(a.accion)) return { ok: false, motivo: `acción rara: ${a.accion}`, uso };
    return { ok: true, accion: { accion: a.accion, texto: String(a.texto ?? '') }, uso };
  } catch (e) {
    uso.ms = Math.round(performance.now() - t0);
    return { ok: false, motivo: String(e).slice(0, 160), uso };
  }
}
