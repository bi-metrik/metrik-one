import { describe, expect, it, vi } from 'vitest';

// Mauricio, 2026-10-20: «Apaga el bot de venezuela». Sin red ni base: wa-respond y el serializador están simulados.
const enviados: Array<{ fn: string; args: unknown[] }> = [];
vi.mock('../wa-respond.ts', () => {
  const reg = (fn: string) => vi.fn(async (...args: unknown[]) => { enviados.push({ fn, args }); });
  return { sendTextMessage: reg('texto'), sendTypingIndicator: reg('escribiendo'), sendContact: reg('tarjeta'), sendButtons: reg('botones'), sendLocationRequest: reg('ubicacion') };
});
vi.mock('./serialize.ts', () => ({ serializeVe: vi.fn(async () => null) }));
vi.mock('../modelo-texto.ts', () => ({ generate: vi.fn(async () => { throw new Error('no debe llamar al modelo'); }) }));

const { VE_APAGADO, cerrarVeChatPorApagado, isVeTrigger } = await import('./index.ts');

function supabaseFalso(fila: unknown) {
  const escrituras: Array<{ tabla: string; op: string; valor: unknown }> = [];
  const desde = (tabla: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => ({ data: fila });
    q.update = (valor: unknown) => { escrituras.push({ tabla, op: 'update', valor }); return q; };
    q.insert = async (valor: unknown) => { escrituras.push({ tabla, op: 'insert', valor }); return { error: null }; };
    return q;
  };
  return { cliente: { from: desde }, escrituras };
}

describe('bot de Venezuela apagado', () => {
  it('está apagado en el código; la palabra clave se sigue reconociendo (el webhook la ignora por VE_APAGADO)', () => {
    expect(VE_APAGADO).toBe(true);
    expect(isVeTrigger('Venezuela')).toBe(true);
  });

  it('una conversación abierta se cierra, se despide sin tarjeta del bot y guarda el registro', async () => {
    enviados.length = 0;
    const { cliente, escrituras } = supabaseFalso({ state: { history: [{ role: 'model', text: 'hola' }], crisis: null, turns: 2, bot_phone: '573000000000' } });
    await cerrarVeChatPorApagado(cliente, '573111111111', 'sigo aquí');
    expect(escrituras[0]).toMatchObject({ tabla: 've_chat_sessions', op: 'update', valor: { closed: true } });
    expect((escrituras[0].valor as { state: { history: unknown[] } }).state.history).toHaveLength(2);
    expect(escrituras.some((e) => e.tabla === 've_respuestas' && e.op === 'insert')).toBe(true);
    expect(enviados.map((e) => e.fn)).toEqual(['texto']);
    expect(String(enviados[0].args[1])).toMatch(/ya terminó/);
  });

  it('sin conversación abierta no hace nada', async () => {
    enviados.length = 0;
    const { cliente, escrituras } = supabaseFalso(null);
    await cerrarVeChatPorApagado(cliente, '573111111111', 'hola');
    expect(escrituras).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });
});
