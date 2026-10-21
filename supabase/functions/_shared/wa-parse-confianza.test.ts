import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// wa-parse lee `Deno.env` al cargar: se simula antes del import.
let parseMessage: (t: string) => Promise<{ intent: string; confidence: number }>;
beforeAll(async () => {
  (globalThis as unknown as { Deno?: unknown }).Deno ??= { env: { get: (k: string) => (k === 'GEMINI_API_KEY' ? 'g' : undefined) } };
  ({ parseMessage } = await import('./wa-parse.ts'));
});
afterEach(() => vi.unstubAllGlobals());

// Eval real con Haiku 5.5 (2026-10-20): reconocía la intención pero bajaba la confianza cuando faltaba el monto o el
// negocio, y el umbral de 0,7 la volvía UNCLEAR. El prompt dice que la confianza es de la INTENCIÓN.
describe('wa-parse: la confianza mide la intención, no los datos completos', () => {
  it('el prompt lo dice explícito, con los casos del eval', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"intent":"ESTADO_NEGOCIOS","confidence":0.9,"fields":{"stage_filter":"all"}}' }] }, finishReason: 'STOP' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const r = await parseMessage('cuántos viajes tengo');
    expect(r.intent).toBe('ESTADO_NEGOCIOS');
    const sistema = JSON.parse(String(f.mock.calls[0][1]?.body)).system_instruction.parts[0].text as string;
    expect(sistema).toMatch(/qué tan seguro estás de la INTENCIÓN/);
    expect(sistema).toMatch(/NO mide si el mensaje trae todos los datos/);
    expect(sistema).toMatch(/cuántos viajes tengo" → ESTADO_NEGOCIOS/);
    expect(sistema).toMatch(/orden de registrar\/cargar un gasto aunque no traiga monto/);
  });
});
