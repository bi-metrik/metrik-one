import { describe, expect, it } from 'vitest'
import { cuerpoAnthropic, leerRespuestaAnthropic, mensajesAnthropic, modeloAnthropic } from './modelo-anthropic'
import type { PedidoModelo } from './tipos'

/** El adaptador nativo de Anthropic (sin red: `fetch` falso). Sin respaldo: nunca llama a Gemini. */

const pedido = (o: Partial<PedidoModelo> = {}): PedidoModelo => ({
  sistema: 'Eres el asistente.',
  mensajes: [
    { role: 'user', parts: [{ text: 'hola' }] },
    { role: 'model', modelo: 'claude-haiku-5-5', parts: [{ functionCall: { name: 'ver_catalogo', args: {}, id: 'toolu_1' } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'ver_catalogo', response: { ok: true }, id: 'toolu_1' } }] },
  ],
  herramientas: [
    { name: 'ver_catalogo', description: 'catálogo', parameters: { type: 'object', properties: {}, required: [] } },
    { name: 'responder', description: 'responde', parameters: { type: 'object', properties: { texto: { type: 'string' }, tema: { type: 'string', enum: ['a', 'fuera'] } }, required: ['texto', 'tema'] } },
  ],
  permitidas: ['ver_catalogo', 'responder'],
  timeoutMs: 5000,
  ...o,
})

const op = { modelo: 'claude-haiku-5-5', esfuerzo: 'low' as const, pensamiento: false, maxSalida: 1024, estricto: true }

describe('cuerpo del pedido', () => {
  it('sin pensamiento: herramienta forzada (any), thinking apagado, caché en sistema y última herramienta, strict, sin temperature', () => {
    const c = cuerpoAnthropic(pedido(), op) as Record<string, any>
    expect(c.model).toBe('claude-haiku-5-5')
    expect(c.tool_choice).toEqual({ type: 'any' })
    expect(c.thinking).toEqual({ type: 'disabled' })
    expect(c.output_config).toEqual({ effort: 'low' })
    expect(c.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(c.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' })
    expect(c.tools[0].cache_control).toBeUndefined()
    expect(c.tools.every((t: any) => t.strict === true)).toBe(true)
    expect(c.tools[1].input_schema.additionalProperties).toBe(false)
    expect(JSON.stringify(c)).not.toMatch(/temperature|top_p|top_k/)
  })
  it('con pensamiento: tool_choice auto y thinking adaptativo', () => {
    const c = cuerpoAnthropic(pedido(), { ...op, pensamiento: true }) as Record<string, any>
    expect(c.tool_choice).toEqual({ type: 'auto' })
    expect(c.thinking).toEqual({ type: 'adaptive' })
  })
  it('en el último llamado solo van las permitidas (una sola: tool_choice tool)', () => {
    const c = cuerpoAnthropic(pedido({ permitidas: ['responder'] }), op) as Record<string, any>
    expect(c.tools.map((t: any) => t.name)).toEqual(['responder'])
    expect(c.tool_choice).toEqual({ type: 'tool', name: 'responder' })
  })
  it('los ids de herramienta viajan reales y el tool_result va primero en el mensaje del usuario', () => {
    const m = mensajesAnthropic(pedido().mensajes, 'claude-haiku-5-5', false)
    expect(m[1]).toEqual({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'ver_catalogo', input: {} }] })
    expect(m[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
  })
  it('el razonamiento solo vuelve con pensamiento y si es de este modelo', () => {
    const msgs = [{ role: 'model' as const, modelo: 'claude-haiku-5-5', parts: [{ thought: true, text: 'pienso', thoughtSignature: 'firma' }, { functionCall: { name: 'x', args: {}, id: 't1' } }] }]
    expect(mensajesAnthropic(msgs, 'claude-haiku-5-5', true)[0].content[0]).toEqual({ type: 'thinking', thinking: 'pienso', signature: 'firma' })
    expect(mensajesAnthropic(msgs, 'claude-haiku-5-5', false)[0].content).toHaveLength(1)
    expect(mensajesAnthropic([{ ...msgs[0], modelo: 'gemini-3.8-flash' }], 'claude-haiku-5-5', true)[0].content).toHaveLength(1)
  })
})

describe('respuesta', () => {
  it('rechazo es su propio motivo; sin herramienta, falla; uso con caché', () => {
    expect(leerRespuestaAnthropic({ stop_reason: 'refusal', content: [] }, 'm')).toMatchObject({ ok: false, motivo: 'refusal' })
    expect(leerRespuestaAnthropic({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hola' }] }, 'm')).toMatchObject({ ok: false, motivo: 'sin llamada (end_turn)' })
    const r = leerRespuestaAnthropic({ stop_reason: 'tool_use', model: 'claude-haiku-5-5', usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 20 }, content: [{ type: 'tool_use', id: 'toolu_9', name: 'responder', input: { texto: 'hola', tema: 'a' } }] }, 'm')
    expect(r).toMatchObject({ ok: true, tokens: { entrada: 1000, cache: 900, salida: 20 }, mensaje: { modelo: 'claude-haiku-5-5', parts: [{ functionCall: { name: 'responder', id: 'toolu_9' } }] } })
  })
})

describe('el llamado', () => {
  it('va solo a Anthropic (nunca a Gemini), con la llave en x-api-key; un 529 vuelve como falla sin respaldo', async () => {
    const urls: string[] = []
    let estado = 529
    const f = (async (u: string, i: RequestInit) => {
      urls.push(u)
      expect((i.headers as Record<string, string>)['x-api-key']).toBe('llave')
      if (estado !== 200) return new Response('{"error":{"message":"overloaded"}}', { status: estado })
      return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'responder', input: { texto: 'hola', tema: 'a' } }], usage: { input_tokens: 5, output_tokens: 3 } }))
    }) as unknown as typeof fetch
    const m = modeloAnthropic({ ...op, llave: 'llave', fetch: f })
    expect(await m.llamar(pedido())).toMatchObject({ ok: false, motivo: 'http 529' })
    estado = 200
    expect(await m.llamar(pedido())).toMatchObject({ ok: true })
    expect(urls.every((u) => u === 'https://api.anthropic.com/v1/messages')).toBe(true)
  })
  it('si la API rechaza el esfuerzo con 400, reintenta una vez sin output_config', async () => {
    const cuerpos: any[] = []
    const f = (async (_u: string, i: RequestInit) => {
      const c = JSON.parse(String(i.body))
      cuerpos.push(c)
      if (c.output_config) return new Response('{"error":{"message":"output_config.effort not supported with thinking disabled"}}', { status: 400 })
      return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'responder', input: {} }] }))
    }) as unknown as typeof fetch
    expect(await modeloAnthropic({ ...op, llave: 'l', fetch: f }).llamar(pedido())).toMatchObject({ ok: true })
    expect(cuerpos.map((c) => !!c.output_config)).toEqual([true, false])
  })
})
