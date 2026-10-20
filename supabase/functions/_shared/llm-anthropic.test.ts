import { describe, expect, it, vi } from 'vitest';
import {
  MODELO_HAIKU,
  URL_ANTHROPIC,
  costoUsd,
  crearFetchModelo,
  cuerpoAnthropicDesdeGemini,
  esfuerzoDesdeGemini,
  esquemaJsonDesdeGemini,
  proveedorLLM,
  respuestaGeminiDesdeAnthropic,
} from './llm-anthropic.ts';

const URL_G = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=g';

function cuerpoG(extra: Record<string, unknown> = {}) {
  return {
    system_instruction: { parts: [{ text: 'Eres un lector.' }] },
    contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 512, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { a: { type: 'STRING', nullable: true } }, required: ['a'] } },
    ...extra,
  };
}

function respuestaA(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });
}

describe('proveedorLLM', () => {
  it('por defecto es anthropic; solo «gemini» explícito vuelve', () => {
    expect(proveedorLLM(undefined)).toBe('anthropic');
    expect(proveedorLLM('')).toBe('anthropic');
    expect(proveedorLLM(' Gemini ')).toBe('gemini');
    expect(proveedorLLM('otro')).toBe('anthropic');
  });
});

describe('esquemaJsonDesdeGemini', () => {
  it('baja tipos, convierte nullable en anyOf con null y cierra objetos', () => {
    const r = esquemaJsonDesdeGemini({
      type: 'OBJECT',
      propertyOrdering: ['x'],
      properties: {
        x: { type: 'STRING', enum: ['a', 'b'], nullable: true, description: 'la x' },
        n: { type: 'INTEGER', minimum: 0 },
        l: { type: 'ARRAY', items: { type: 'OBJECT', properties: { k: { type: 'STRING' } } } },
      },
      required: ['x'],
    });
    expect(r).toEqual({
      type: 'object',
      properties: {
        x: { description: 'la x', anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'null' }] },
        n: { type: 'integer', description: 'minimum: 0.' },
        l: { type: 'array', items: { type: 'object', properties: { k: { type: 'string' } }, additionalProperties: false } },
      },
      additionalProperties: false,
      required: ['x'],
    });
  });
});

describe('esfuerzoDesdeGemini', () => {
  it('presupuesto 0 o sin config = sin pensamiento; niveles y presupuestos a esfuerzo', () => {
    expect(esfuerzoDesdeGemini(undefined)).toBeNull();
    expect(esfuerzoDesdeGemini({ thinkingBudget: 0 })).toBeNull();
    expect(esfuerzoDesdeGemini({ thinkingBudget: 1024 })).toBe('low');
    expect(esfuerzoDesdeGemini({ thinkingBudget: 4096 })).toBe('medium');
    expect(esfuerzoDesdeGemini({ thinkingBudget: -1 })).toBe('medium');
    expect(esfuerzoDesdeGemini({ thinkingLevel: 'MINIMAL' })).toBe('low');
    expect(esfuerzoDesdeGemini({ thinkingLevel: 'HIGH' })).toBe('high');
  });
});

describe('cuerpoAnthropicDesdeGemini', () => {
  it('sistema, mensajes, sin temperatura, salida estructurada y sin pensamiento', () => {
    const t = cuerpoAnthropicDesdeGemini(cuerpoG());
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.cuerpo).toMatchObject({
      model: MODELO_HAIKU,
      max_tokens: 512,
      system: 'Eres un lector.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      thinking: { type: 'disabled' },
      output_config: { format: { type: 'json_schema' } },
    });
    expect(t.cuerpo).not.toHaveProperty('temperature');
    expect(t.conEsquema).toBe(true);
  });

  it('imagen, PDF y texto plano; image/jpg se normaliza', () => {
    const t = cuerpoAnthropicDesdeGemini({
      contents: [{ parts: [
        { inline_data: { mime_type: 'image/jpg', data: 'AAAA' } },
        { inlineData: { mimeType: 'application/pdf', data: 'BBBB' } },
        { inline_data: { mime_type: 'text/plain', data: btoa('línea') } },
        { text: 'lee' },
      ] }],
      generationConfig: { thinkingConfig: { thinkingBudget: 1024 } },
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const c = (t.cuerpo.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
    expect(c[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(c[1]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' } });
    expect(c[2]).toMatchObject({ type: 'document', source: { type: 'text', media_type: 'text/plain' } });
    expect(t.cuerpo.thinking).toEqual({ type: 'adaptive' });
    expect(t.cuerpo.output_config).toEqual({ effort: 'low' });
  });

  it('audio, video, HEIC e imagen de más de 5 MB no se traducen (siguen en Gemini)', () => {
    const conParte = (p: unknown) => cuerpoAnthropicDesdeGemini({ contents: [{ parts: [p] }] });
    expect(conParte({ inline_data: { mime_type: 'audio/ogg', data: 'x' } }).ok).toBe(false);
    expect(conParte({ inline_data: { mime_type: 'video/mp4', data: 'x' } }).ok).toBe(false);
    expect(conParte({ inline_data: { mime_type: 'image/heic', data: 'x' } }).ok).toBe(false);
    expect(conParte({ inline_data: { mime_type: 'image/png', data: 'A'.repeat(7_200_000) } }).ok).toBe(false);
  });

  it('JSON sin esquema: lo pide en el sistema', () => {
    const t = cuerpoAnthropicDesdeGemini({ contents: [{ parts: [{ text: 'x' }] }], generationConfig: { responseMimeType: 'application/json' } });
    expect(t.ok && String(t.cuerpo.system)).toMatch(/objeto JSON válido/);
  });

  it('herramientas: modo ANY con permitidas, tool_use/tool_result emparejados y sin pensamiento', () => {
    const t = cuerpoAnthropicDesdeGemini({
      system_instruction: { parts: [{ text: 's' }] },
      contents: [
        { role: 'user', parts: [{ text: 'hola' }] },
        { role: 'model', parts: [{ functionCall: { name: 'buscar', args: { q: 'x' } }, thoughtSignature: 'sig' }] },
        { role: 'user', parts: [{ functionResponse: { name: 'buscar', response: { ok: true } } }] },
      ],
      tools: [{ functionDeclarations: [
        { name: 'buscar', description: 'b', parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } } } },
        { name: 'responder', parameters: { type: 'OBJECT', properties: { texto: { type: 'STRING' } } } },
        { name: 'proponer', parameters: { type: 'OBJECT', properties: {} } },
      ] }],
      toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['responder', 'proponer'] } },
      generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'LOW' } },
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const m = t.cuerpo.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m[1].content[0]).toEqual({ type: 'tool_use', id: 'toolu_g1', name: 'buscar', input: { q: 'x' } });
    expect(m[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_g1', content: '{"ok":true}' });
    expect((t.cuerpo.tools as Array<{ name: string }>).map((x) => x.name)).toEqual(['responder', 'proponer']);
    expect(t.cuerpo.tool_choice).toEqual({ type: 'any' });
    expect(t.cuerpo.thinking).toEqual({ type: 'disabled' });
  });
});

describe('respuestaGeminiDesdeAnthropic', () => {
  it('texto, tool_use, motivo de fin y uso', () => {
    const r = respuestaGeminiDesdeAnthropic({
      content: [{ type: 'thinking' }, { type: 'text', text: '{"a":1}' }, { type: 'tool_use', name: 'responder', input: { texto: 'hola' } }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 },
    }) as { candidates: Array<{ content: { parts: unknown[] }; finishReason: string }>; usageMetadata: Record<string, number> };
    expect(r.candidates[0].content.parts).toEqual([{ text: '{"a":1}' }, { functionCall: { name: 'responder', args: { texto: 'hola' } } }]);
    expect(r.candidates[0].finishReason).toBe('STOP');
    expect(r.usageMetadata).toMatchObject({ promptTokenCount: 150, candidatesTokenCount: 20, cachedContentTokenCount: 50 });
    expect(respuestaGeminiDesdeAnthropic({ stop_reason: 'max_tokens' })).toMatchObject({ candidates: [{ finishReason: 'MAX_TOKENS' }] });
    expect(respuestaGeminiDesdeAnthropic({ stop_reason: 'refusal' })).toMatchObject({ candidates: [{ finishReason: 'SAFETY' }] });
  });

  it('costo con el precio de Haiku 5.5', () => {
    expect(costoUsd(1_000_000, 1_000_000)).toBeCloseTo(0.6);
  });
});

describe('crearFetchModelo', () => {
  const init = { method: 'POST', body: JSON.stringify(cuerpoG()) };

  it('LLM_PROVEEDOR=gemini: el fetch de siempre, sin tocar el pedido', async () => {
    const real = vi.fn(async () => respuestaA({ ok: 1 }));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: (k) => ({ LLM_PROVEEDOR: 'gemini', ANTHROPIC_API_KEY: 'sk' } as Record<string, string>)[k] });
    await f(URL_G, init);
    expect(real).toHaveBeenCalledWith(URL_G, init);
  });

  it('sin ANTHROPIC_API_KEY: sigue en Gemini y avisa una vez', async () => {
    const real = vi.fn(async () => respuestaA({ ok: 1 }));
    const avisar = vi.fn();
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: () => undefined, avisar });
    await f(URL_G, init);
    expect(real.mock.calls[0][0]).toBe(URL_G);
  });

  it('otra URL nunca se intercepta', async () => {
    const real = vi.fn(async () => respuestaA({}));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: () => 'sk' });
    await f('https://example.com/x', { method: 'GET' });
    expect(real.mock.calls[0][0]).toBe('https://example.com/x');
  });

  it('con llave: llama a Anthropic y devuelve la forma de Gemini', async () => {
    const real = vi.fn(async (_u: unknown, _i?: RequestInit) => respuestaA({ content: [{ type: 'text', text: '{"a":"x"}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: (k) => (k === 'ANTHROPIC_API_KEY' ? 'sk-ant-x' : undefined) });
    const res = await f(URL_G, init);
    expect(real.mock.calls[0][0]).toBe(URL_ANTHROPIC);
    const h = real.mock.calls[0][1]?.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant-x');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.candidates[0].content.parts[0].text).toBe('{"a":"x"}');
    expect(d.candidates[0].finishReason).toBe('STOP');
  });

  it('529 de Anthropic llega como 503 (lo que los sitios reintentan)', async () => {
    const real = vi.fn(async () => respuestaA({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: (k) => (k === 'ANTHROPIC_API_KEY' ? 'sk' : undefined) });
    const res = await f(URL_G, init);
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/Overloaded/);
  });

  it('400 por el esquema: reintenta una vez sin format, con el esquema en el sistema', async () => {
    const real = vi.fn()
      .mockResolvedValueOnce(respuestaA({ type: 'error', error: { type: 'invalid_request_error', message: 'output_config.format.schema: too complex' } }, 400))
      .mockResolvedValueOnce(respuestaA({ content: [{ type: 'text', text: '{"a":null}' }], stop_reason: 'end_turn' }));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: (k) => (k === 'ANTHROPIC_API_KEY' ? 'sk' : undefined), avisar: () => {} });
    const res = await f(URL_G, init);
    expect(res.status).toBe(200);
    const segundo = JSON.parse(real.mock.calls[1][1].body);
    expect(segundo.output_config).toBeUndefined();
    expect(segundo.system).toMatch(/JSON Schema/);
  });

  it('el pedido de audio sigue en Gemini aunque haya llave', async () => {
    const real = vi.fn(async () => respuestaA({}));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: (k) => (k === 'ANTHROPIC_API_KEY' ? 'sk' : undefined), avisar: () => {} });
    await f(URL_G, { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'audio/ogg', data: 'x' } }] }] }) });
    expect(real.mock.calls[0][0]).toBe(URL_G);
  });
});
