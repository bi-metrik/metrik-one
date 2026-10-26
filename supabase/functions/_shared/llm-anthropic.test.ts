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
  ajustarEsquema,
  contarEsquema,
  promoverOpcionales,
  LIMITE_OPCIONALES,
  proveedorDe,
  sinCercas,
  modeloQueRespondio,
} from './llm-anthropic.ts';
import { esquemaCarga } from './agente/bandeja/extraccion.ts';
import { CAMPOS_ARNES } from './agente/arnes/conjuntos.ts';

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
  it('dos turnos seguidos del usuario se juntan y el tool_result queda primero', () => {
    const t = cuerpoAnthropicDesdeGemini({
      contents: [
        { role: 'model', parts: [{ functionCall: { name: 'buscar', args: {} } }] },
        { role: 'user', parts: [{ text: 'y además' }] },
        { role: 'user', parts: [{ functionResponse: { name: 'buscar', response: { n: 1 } } }] },
      ],
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const m = t.cuerpo.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(m.map((x) => x.role)).toEqual(['assistant', 'user']);
    expect(m[1].content.map((b) => b.type)).toEqual(['tool_result', 'text']);
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

describe('modeloQueRespondio (telemetría)', () => {
  it('Haiku traducido a la forma de Gemini: el modelo de Anthropic, no el Gemini pedido', async () => {
    const real = vi.fn(async () => respuestaA({ model: 'claude-haiku-5-5', content: [{ type: 'text', text: '{"a":"x"}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: (k) => (k === 'ANTHROPIC_API_KEY' ? 'sk' : undefined) });
    const d = await (await f(URL_G, { method: 'POST', body: JSON.stringify(cuerpoG()) })).json();
    expect(modeloQueRespondio(d, 'gemini-3.5-flash-lite')).toBe('claude-haiku-5-5');
  });

  it('Gemini (o el respaldo en Gemini): su modelVersion; sin modelVersion, el pedido', () => {
    expect(modeloQueRespondio({ modelVersion: 'gemini-3.5-flash-lite' }, 'x')).toBe('gemini-3.5-flash-lite');
    expect(modeloQueRespondio({}, 'gemini-3.5-flash-lite')).toBe('gemini-3.5-flash-lite');
    expect(modeloQueRespondio(null, 'gemini-3.5-flash-lite')).toBe('gemini-3.5-flash-lite');
    expect(modeloQueRespondio({ modelVersion: '  ' }, 'pedido')).toBe('pedido');
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

  const URL_SIN_LLAVE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
  const conLlaveA = (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'sk' : undefined);

  it('529 sin llave de Gemini: no hay respaldo, llega como 503 (lo que los sitios reintentan) y queda en el log', async () => {
    const real = vi.fn(async () => respuestaA({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529));
    const avisar = vi.fn();
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: conLlaveA, avisar });
    const res = await f(URL_SIN_LLAVE, init);
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/Overloaded/);
    expect(real).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls.flat().join(' ')).toMatch(/no hay GEMINI_API_KEY: sin respaldo/);
  });

  it('529 con llave de Gemini: el MISMO pedido sale al respaldo en Gemini', async () => {
    const real = vi.fn()
      .mockResolvedValueOnce(respuestaA({ type: 'error', error: { type: 'overloaded_error' } }, 529))
      .mockResolvedValueOnce(respuestaA({ candidates: [{ content: { parts: [{ text: '{"a":"g"}' }] }, finishReason: 'STOP' }] }));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: conLlaveA, avisar: () => {} });
    const res = await f(URL_G, init);
    expect(real.mock.calls[0][0]).toBe(URL_ANTHROPIC);
    expect(real.mock.calls[1]).toEqual([URL_G, init]);
    expect((await res.json()).candidates[0].content.parts[0].text).toBe('{"a":"g"}');
  });

  it('la llave en la cabecera x-goog-api-key también habilita el respaldo; un error de red de Haiku va al respaldo', async () => {
    const real = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(respuestaA({ ok: 1 }));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: conLlaveA, avisar: () => {} });
    const initH = { ...init, headers: { 'x-goog-api-key': 'g' } };
    await f(URL_SIN_LLAVE, initH);
    expect(real.mock.calls[1]).toEqual([URL_SIN_LLAVE, initH]);
  });

  it('sin respaldo: un 400 del pedido, o el corte del sitio ya vencido', async () => {
    const r400 = vi.fn(async () => respuestaA({ type: 'error', error: { type: 'invalid_request_error', message: 'mal' } }, 400));
    const f1 = crearFetchModelo({ fetch: r400 as unknown as typeof fetch, entorno: conLlaveA, avisar: () => {} });
    expect((await f1(URL_G, { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'x' }] }] }) })).status).toBe(400);
    expect(r400).toHaveBeenCalledTimes(1);

    const corte = new AbortController();
    corte.abort();
    const r529 = vi.fn(async () => respuestaA({}, 529));
    const f2 = crearFetchModelo({ fetch: r529 as unknown as typeof fetch, entorno: conLlaveA, avisar: () => {} });
    expect((await f2(URL_G, { ...init, signal: corte.signal })).status).toBe(503);
    expect(r529).toHaveBeenCalledTimes(1);
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

describe('presupuesto del esquema (400 «too many optional parameters»)', () => {
  const muchos = (n: number, tipo: 'array' | 'string') => ({
    type: 'object',
    properties: Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, tipo === 'array' ? { type: 'array', items: { type: 'string' } } : { type: 'string' }])),
    required: [],
    additionalProperties: false,
  });

  it('cuenta opcionales y uniones en todos los niveles', () => {
    expect(contarEsquema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { anyOf: [{ type: 'string' }, { type: 'null' }] }, l: { type: 'array', items: { type: 'object', properties: { x: { type: 'string' } } } } },
      required: ['a'],
    })).toEqual({ opcionales: 3, uniones: 1 });
  });

  it('un esquema que cabe viaja tal cual', () => {
    const e = muchos(LIMITE_OPCIONALES, 'string');
    expect(ajustarEsquema(e)).toEqual({ modo: 'estricto', esquema: e, promovido: false });
  });

  it('arreglos opcionales de más: pasan a requeridos (sin dato = lista vacía) y el esquema queda estricto', () => {
    const r = ajustarEsquema(muchos(30, 'array'));
    expect(r.modo).toBe('estricto');
    if (r.modo !== 'estricto') return;
    expect(r.promovido).toBe(true);
    expect(contarEsquema(r.esquema).opcionales).toBe(0);
    expect((r.esquema as { properties: Record<string, unknown> }).properties.c0).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('promover: lo opcional que no es arreglo admite null, lo que ya admitía null no se envuelve dos veces', () => {
    const p = promoverOpcionales({ type: 'object', properties: { a: { type: 'string', description: 'd' }, b: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: [] }) as { properties: Record<string, unknown>; required: string[] };
    expect(p.required).toEqual(['a', 'b']);
    expect(p.properties.a).toEqual({ description: 'd', anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(p.properties.b).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });

  it('el esquema de carga real del bot (33 opcionales) va en el sistema desde la primera llamada, sin format', () => {
    const esquema = esquemaCarga(CAMPOS_ARNES, { perfil: true });
    const t = cuerpoAnthropicDesdeGemini({
      system_instruction: { parts: [{ text: 'Extrae.' }] },
      contents: [{ parts: [{ text: 'Mensajes: hola' }] }],
      generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: esquema },
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(contarEsquema(esquemaJsonDesdeGemini(esquema)).opcionales).toBeGreaterThan(LIMITE_OPCIONALES);
    expect(t.cuerpo.output_config).toBeUndefined();
    expect(t.conEsquema).toBe(false);
    expect(String(t.cuerpo.system)).toMatch(/^Extrae\.\n\nResponde únicamente con un objeto JSON válido que cumpla este JSON Schema/);
  });
});

describe('interruptor por familia (LLM_PROVEEDOR_DOCUMENTOS, LLM_PROVEEDOR_ACTAS)', () => {
  const ent = (v: Record<string, string>) => (k: string) => v[k];
  const docs = { variable: 'LLM_PROVEEDOR_DOCUMENTOS', porDefecto: 'gemini' as const };

  it('sin valor rige el de la familia (gemini); con valor manda la familia', () => {
    expect(proveedorDe(ent({}), docs)).toBe('gemini');
    expect(proveedorDe(ent({ LLM_PROVEEDOR: 'anthropic' }), docs)).toBe('gemini');
    expect(proveedorDe(ent({ LLM_PROVEEDOR_DOCUMENTOS: 'anthropic' }), docs)).toBe('anthropic');
    expect(proveedorDe(ent({}))).toBe('anthropic');
  });

  it('el global en gemini devuelve todo a Gemini, aunque la familia diga anthropic', () => {
    expect(proveedorDe(ent({ LLM_PROVEEDOR: 'gemini', LLM_PROVEEDOR_DOCUMENTOS: 'anthropic' }), docs)).toBe('gemini');
  });

  it('un fetch de documentos sin la variable no toca a Anthropic aunque haya llave', async () => {
    const real = vi.fn(async () => respuestaA({ ok: 1 }));
    const f = crearFetchModelo({ ...docs, fetch: real as unknown as typeof fetch, entorno: ent({ ANTHROPIC_API_KEY: 'sk' }) });
    await f(URL_G, { method: 'POST', body: JSON.stringify(cuerpoG()) });
    expect(real.mock.calls[0][0]).toBe(URL_G);
  });
});

describe('JSON sin esquema: sin cercas de código (RUT)', () => {
  it('sinCercas quita ```json … ``` y deja lo demás igual', () => {
    expect(sinCercas('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(sinCercas('```\n{"a":1}```')).toBe('{"a":1}');
    expect(sinCercas('{"a":1}')).toBe('{"a":1}');
    expect(sinCercas('texto con ``` en medio')).toBe('texto con ``` en medio');
  });

  it('la respuesta de Haiku con cercas llega al sitio como JSON limpio cuando no hubo salida estructurada', async () => {
    const real = vi.fn(async () => respuestaA({ content: [{ type: 'text', text: '```json\n{"nit":{"value":"1"}}\n```' }], stop_reason: 'end_turn' }));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: (k) => (k === 'ANTHROPIC_API_KEY' ? 'sk' : undefined) });
    const res = await f(URL_G, { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'x' }] }], generationConfig: { responseMimeType: 'application/json' } }) });
    const texto = (await res.json()).candidates[0].content.parts[0].text;
    expect(JSON.parse(texto)).toEqual({ nit: { value: '1' } });
  });

  it('un texto libre (sin JSON pedido) no se toca', async () => {
    const real = vi.fn(async () => respuestaA({ content: [{ type: 'text', text: '```js\nx\n```' }], stop_reason: 'end_turn' }));
    const f = crearFetchModelo({ fetch: real as unknown as typeof fetch, entorno: (k) => (k === 'ANTHROPIC_API_KEY' ? 'sk' : undefined) });
    const res = await f(URL_G, { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'x' }] }] }) });
    expect((await res.json()).candidates[0].content.parts[0].text).toBe('```js\nx\n```');
  });
});

describe('falloDeCuenta: la cuenta de Anthropic no atiende → respaldo en Gemini', () => {
  it('sin crédito (400), llave inválida (401) o sin permiso (403) sí; un 400 del pedido no', async () => {
    const { falloDeCuenta } = await import('./llm-anthropic')
    expect(falloDeCuenta(400, 'anthropic 400: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing')).toBe(true)
    expect(falloDeCuenta(401, 'invalid x-api-key')).toBe(true)
    expect(falloDeCuenta(403, 'forbidden')).toBe(true)
    expect(falloDeCuenta(400, 'messages.2: tool_use ids were found without tool_result')).toBe(false)
  })
})
