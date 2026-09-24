// La telemetria de Cardumen existe para una sola pregunta: cuanto le cuesta cada estudio al
// numero de WhatsApp que comparte con ONE. Lo que se prueba aqui es que la marca separe
// Cardumen de ONE, que no se guarde lo que dijo la persona, y que registrar nunca tumbe un turno.
import { describe, expect, it, vi } from 'vitest';
import {
  conTelemetria,
  ctxCardumen,
  filaLlamadaModelo,
  intentCardumen,
  registrarLlamadaModelo,
  type UsoModelo,
} from './telemetria';
import type { ModelAdapter } from './types';

function adaptador(resultado: () => Promise<{ text: string; usage?: { in: number; out: number } }>): ModelAdapter {
  return { id: 'gemini-3.1-flash-lite', pricing: { in: 0.25, out: 1.5 }, call: vi.fn(resultado) };
}

describe('intentCardumen', () => {
  it('prefija el estudio', () => {
    expect(intentCardumen('cometa')).toBe('cardumen:cometa');
  });
  it('sin estudio no queda nulo: nulo es lo que distingue a ONE', () => {
    for (const e of [null, undefined, '', '   ']) expect(intentCardumen(e)).toBe('cardumen:desconocido');
  });
});

describe('ctxCardumen', () => {
  it('marca origen bot (el CHECK de wa_envios no admite otro) e intent por estudio', () => {
    const ctx = ctxCardumen('navigate', 'hola');
    expect(ctx.origen).toBe('bot');
    expect(ctx.intent).toBe('cardumen:navigate');
  });
  it('el preview no lleva el texto del mensaje, solo el largo', () => {
    const texto = 'Cuéntame de cuando tu hija de 14 años dejó el colegio';
    const ctx = ctxCardumen('cometa', texto);
    expect(ctx.preview).toBe(`[cardumen:cometa] ${texto.length} car.`);
    expect(ctx.preview).not.toContain('hija');
  });
  it('sin texto (CTA, Flow) el preview es solo la marca', () => {
    expect(ctxCardumen('fede').preview).toBe('[cardumen:fede]');
  });
});

describe('conTelemetria', () => {
  it('reporta modelo, tokens y latencia de cada llamada exitosa', async () => {
    const usos: UsoModelo[] = [];
    let t = 1000;
    const reloj = () => (t += 250);
    const m = conTelemetria(adaptador(async () => ({ text: '{}', usage: { in: 812, out: 40 } })), (u) => usos.push(u), reloj);
    const r = await m.call({ system: 's', messages: [] });
    expect(r.text).toBe('{}');
    expect(usos).toEqual([{ modelo: 'gemini-3.1-flash-lite', tokensEntrada: 812, tokensSalida: 40, latenciaMs: 250 }]);
  });

  it('conserva id y precio del adaptador', () => {
    const m = conTelemetria(adaptador(async () => ({ text: '' })), () => {});
    expect(m.id).toBe('gemini-3.1-flash-lite');
    expect(m.pricing).toEqual({ in: 0.25, out: 1.5 });
  });

  it('sin usage reporta ceros, no se salta la fila', async () => {
    const usos: UsoModelo[] = [];
    await conTelemetria(adaptador(async () => ({ text: 'x' })), (u) => usos.push(u)).call({ system: '', messages: [] });
    expect(usos[0]).toMatchObject({ tokensEntrada: 0, tokensSalida: 0 });
  });

  it('una llamada que falla sube su error y no reporta uso', async () => {
    const onUso = vi.fn();
    const m = conTelemetria(adaptador(async () => { throw new Error('Gemini 503'); }), onUso);
    await expect(m.call({ system: '', messages: [] })).rejects.toThrow('Gemini 503');
    expect(onUso).not.toHaveBeenCalled();
  });

  it('si registrar falla, el turno sigue con la respuesta del modelo', async () => {
    const m = conTelemetria(adaptador(async () => ({ text: 'ok', usage: { in: 1, out: 1 } })), () => {
      throw new Error('base caida');
    });
    await expect(m.call({ system: '', messages: [] })).resolves.toMatchObject({ text: 'ok' });
  });
});

describe('filaLlamadaModelo', () => {
  const uso: UsoModelo = { modelo: 'claude-haiku-4-5', tokensEntrada: 1500, tokensSalida: 200, latenciaMs: 900 };

  it('lleva modelo, tokens, latencia e intent del estudio', () => {
    expect(filaLlamadaModelo('turismo', uso)).toMatchObject({
      direction: 'inbound',
      intent: 'cardumen:turismo',
      gemini_model: 'claude-haiku-4-5',
      gemini_input_tokens: 1500,
      gemini_output_tokens: 200,
      gemini_latency_ms: 900,
    });
  });

  it('sin telefono ni texto: ni el dato de la persona ni el cupo del bot de ONE', () => {
    const fila = filaLlamadaModelo('cometa', uso);
    expect(fila.phone).toBeNull();
    expect(fila.message_preview).toBeNull();
    expect(fila.workspace_id).toBeNull();
  });
});

describe('registrarLlamadaModelo', () => {
  const uso: UsoModelo = { modelo: 'gemini-3.1-flash-lite', tokensEntrada: 10, tokensSalida: 2, latenciaMs: 5 };

  it('inserta la fila en wa_message_log', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ insert }));
    await registrarLlamadaModelo({ from }, 'navigate', uso);
    expect(from).toHaveBeenCalledWith('wa_message_log');
    expect(insert).toHaveBeenCalledWith(filaLlamadaModelo('navigate', uso));
  });

  it('un error de la base se escribe en consola y no lanza', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supa = { from: () => ({ insert: async () => ({ error: { message: 'violates check constraint' } }) }) };
    await expect(registrarLlamadaModelo(supa, 'x', uso)).resolves.toBeUndefined();
    const lanza = { from: () => { throw new Error('sin red'); } };
    await expect(registrarLlamadaModelo(lanza, 'x', uso)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});
