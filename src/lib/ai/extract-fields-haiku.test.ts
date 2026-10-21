import { afterEach, describe, expect, it, vi } from 'vitest'

import { extractFieldsFromDocument, type CampoExtraccion } from './extract-fields'

// Eval real con Haiku 5.5 (2026-10-20): campos visibles que quedaban vacíos y NIT con el DV pegado. El prompt lo dice
// explícito, y del lado de Anthropic el pedido piensa con esfuerzo bajo (el `thinkingBudget: 1024` de Gemini).
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const campos: CampoExtraccion[] = [
  { slug: 'nit', label: 'NIT', tipo: 'texto', required: true, descripcion_ai: 'NIT del vendedor' } as CampoExtraccion,
  { slug: 'fecha_expedicion', label: 'Fecha de expedición', tipo: 'fecha', required: false, descripcion_ai: 'Fecha de expedición' } as CampoExtraccion,
]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('extract-fields con Haiku (LLM_PROVEEDOR_DOCUMENTOS=anthropic)', () => {
  it('el prompt pide el NIT sin DV y no dejar vacío lo visible; el pedido piensa con esfuerzo bajo', async () => {
    vi.stubEnv('LLM_PROVEEDOR', 'anthropic')
    vi.stubEnv('LLM_PROVEEDOR_DOCUMENTOS', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-prueba')
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({
      content: [{ type: 'text', text: '{"nit":{"value":"860047657","confidence":0.95},"fecha_expedicion":{"value":"2026-01-15","confidence":0.9}}' }],
      stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 30 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', f)

    const r = await extractFieldsFromDocument(PNG_1X1, 'image/png', campos, 'g')

    expect(r.data?.nit.value).toBe('860047657')
    expect(f.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
    const cuerpo = JSON.parse(String(f.mock.calls[0][1]?.body))
    expect(cuerpo.thinking).toEqual({ type: 'adaptive' })
    expect(cuerpo.output_config.effort).toBe('low')
    expect(cuerpo.system).toMatch(/NIT: devuélvelo SIN el dígito de verificación/)
    expect(cuerpo.system).toMatch(/NO dejes en null un campo que SÍ aparece/)
  })

  it('sin la variable de documentos, el mismo pedido sigue en Gemini aunque haya llave de Anthropic', async () => {
    vi.stubEnv('LLM_PROVEEDOR', 'anthropic')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-prueba')
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"nit":{"value":"860047657","confidence":0.95},"fecha_expedicion":{"value":null,"confidence":0}}' }] }, finishReason: 'STOP' }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    await extractFieldsFromDocument(PNG_1X1, 'image/png', campos, 'g')
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//)
  })
})
