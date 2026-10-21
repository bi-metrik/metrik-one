import { afterEach, describe, expect, it, vi } from 'vitest'

import { clasificarGastoConIA } from './clasificar-gasto-ia'

// Un sitio real con el interruptor en Anthropic: el pedido sale a la API de Mensajes con el prompt y el esquema de
// siempre, y la respuesta de Haiku se lee con el mismo código que leía la de Gemini.
describe('clasificarGastoConIA con LLM_PROVEEDOR=anthropic', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('va a claude-haiku-5-5 y usa su respuesta', async () => {
    vi.stubEnv('LLM_PROVEEDOR', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-prueba')
    vi.stubEnv('GEMINI_API_KEY', 'g')
    const f = vi.fn(async (_u: string, _i?: RequestInit) =>
      new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"categoria":"alimentacion","clasificacion":"variable"}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 12 },
      }), { status: 200 }),
    )
    vi.stubGlobal('fetch', f)

    const r = await clasificarGastoConIA('Almuerzo de la cuadrilla')

    expect(r).toEqual({ categoria: 'alimentacion', clasificacion: 'variable', origen: 'ia' })
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
    const cuerpo = JSON.parse(String(f.mock.calls[0][1]?.body))
    expect(cuerpo.model).toBe('claude-haiku-5-5')
    expect(cuerpo.system).toMatch(/Clasificas gastos/)
    expect(cuerpo).not.toHaveProperty('temperature')
    expect(cuerpo.output_config.format.schema.required).toEqual(['categoria', 'clasificacion'])
  })

  it('un 529 de Anthropic cae al respaldo por palabras, como un fallo de Gemini', async () => {
    vi.stubEnv('LLM_PROVEEDOR', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-prueba')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 })))
    const r = await clasificarGastoConIA('Almuerzo de la cuadrilla')
    expect(r?.origen).not.toBe('ia')
  })
})
