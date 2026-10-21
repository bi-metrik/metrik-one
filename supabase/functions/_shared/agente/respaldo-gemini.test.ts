import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_POR_DEFECTO } from './config'
import { FIRMA_DE_RELLENO, historialPara, modeloGemini } from './modelo-gemini'
import type { PedidoModelo } from './tipos'

// Mauricio, 2026-10-20: «Si, siempre el respaldo de gemini». Con Haiku de principal, el respaldo del bot va directo a
// Gemini (nunca a Haiku); sin llave de Gemini no hay respaldo. Ninguna llamada sale: el fetch está simulado.
const principal = CONFIG_POR_DEFECTO.principal
const respaldo = CONFIG_POR_DEFECTO.respaldo!
const pedido: PedidoModelo = {
  sistema: 'S', herramientas: [{ name: 'responder', description: 'd', parameters: {} }], permitidas: ['responder'], timeoutMs: 10_000,
  mensajes: [
    { role: 'user', parts: [{ text: 'hola' }] },
    { role: 'model', modelo: 'claude-haiku-5-5', parts: [{ functionCall: { name: 'buscar', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'buscar', response: { ok: true } } }] },
  ],
}
const deGemini = (texto: string) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ functionCall: { name: 'responder', args: { texto } } }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
}), { status: 200 })
const deHaiku = (texto: string) => new Response(JSON.stringify({
  content: [{ type: 'tool_use', id: 't', name: 'responder', input: { texto } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 2 },
}), { status: 200 })
const tarda = (ms: number, init?: RequestInit) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  init?.signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('a'), { name: 'AbortError' })) })
})

function conHaiku() {
  vi.stubEnv('LLM_PROVEEDOR', 'anthropic')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-prueba')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('bot: el respaldo siempre en Gemini', () => {
  it('lo que contestó Haiku queda marcado con su modelo, en el mensaje y en el uso', async () => {
    conHaiku()
    const f = vi.fn(async (url: string) => (url.startsWith('https://api.anthropic.com/') ? deHaiku('hola') : deGemini('gemini')))
    vi.stubGlobal('fetch', f)
    const r = await modeloGemini({ llave: 'k', principal, respaldo, corteMs: 5_000 }).llamar(pedido)
    expect(r.ok && r.mensaje.modelo).toBe('claude-haiku-5-5')
    expect(r.usos.map((u) => [u.modelo, u.ok])).toEqual([['claude-haiku-5-5', true]])
    expect(f.mock.calls.map((c) => c[0])).toEqual(['https://api.anthropic.com/v1/messages'])
  })

  it('pasado el corte, el respaldo sale DIRECTO a Gemini con su modelo (no a Haiku)', async () => {
    conHaiku()
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://api.anthropic.com/')) {
        await tarda(5_000, init)
        return deHaiku('tarde')
      }
      return deGemini('respaldo')
    })
    vi.stubGlobal('fetch', f)
    const r = await modeloGemini({ llave: 'k', principal, respaldo, corteMs: 50 }).llamar(pedido)
    expect(r.ok && r.mensaje.modelo).toBe(respaldo.modelo)
    const urls = f.mock.calls.map((c) => String(c[0]))
    expect(urls.filter((u) => u.startsWith('https://api.anthropic.com/'))).toHaveLength(1)
    expect(urls.some((u) => u.includes(`/models/${respaldo.modelo}:generateContent`))).toBe(true)
    // El historial de Haiku (sin firma) viaja a Gemini con la firma de relleno.
    const alRespaldo = f.mock.calls.find((c) => String(c[0]).includes(respaldo.modelo))!
    expect(JSON.parse(String(alRespaldo[1]?.body)).contents[1].parts[0].thoughtSignature).toBe(FIRMA_DE_RELLENO)
  })

  it('sin llave de Gemini: sin respaldo, y queda en el log', async () => {
    conHaiku()
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = vi.fn(async () => new Response('{"type":"error"}', { status: 500 }))
    vi.stubGlobal('fetch', f)
    const r = await modeloGemini({ llave: '', principal, respaldo, corteMs: 5_000, haiku: true }).llamar(pedido)
    expect(r.ok).toBe(false)
    expect(r.usos).toHaveLength(1)
    expect(f.mock.calls.every((c) => String(c[0]).startsWith('https://api.anthropic.com/'))).toBe(true)
    expect(aviso.mock.calls.flat().join(' ')).toMatch(/SIN respaldo|sin respaldo/)
    aviso.mockRestore()
  })

  it('una llamada a función de otro modelo sin firma recibe la de relleno; la del mismo modelo no se toca', () => {
    expect(historialPara(pedido.mensajes, 'gemini-3.8-flash')[1].parts[0].thoughtSignature).toBe(FIRMA_DE_RELLENO)
    expect(historialPara(pedido.mensajes, 'claude-haiku-5-5')[1].parts[0].thoughtSignature).toBeUndefined()
  })
})
