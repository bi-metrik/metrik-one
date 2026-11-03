import { describe, expect, it } from 'vitest'
import { leerConGemini } from './lectura-gemini'

/** Un `fetch` que contesta, en orden, con estos textos (forma de Gemini, terminación STOP). */
function respuestas(textos: string[]): { fetch: typeof fetch; llamados: () => number } {
  let i = 0
  const f = (async () => {
    const text = textos[Math.min(i++, textos.length - 1)]
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 })
  }) as typeof fetch
  return { fetch: f, llamados: () => i }
}

const pedido = { apiKey: 'llave-de-prueba', modelo: 'modelo-de-prueba', instrucciones: 'x', texto: 'y', esquema: {} }

describe('leerConGemini: un JSON roto se pide una vez más', () => {
  it('a la segunda sale bien: devuelve el JSON (arnés con Haiku, 2026-11-03)', async () => {
    const r = respuestas(['{"datos": {"adultos" 2}}', '{"datos": {"adultos": 2}}'])
    expect(await leerConGemini({ ...pedido, fetch: r.fetch })).toEqual({ json: { datos: { adultos: 2 } }, finishReason: 'STOP', error: null })
    expect(r.llamados()).toBe(2)
  })

  it('roto las dos veces: el error de siempre, sin una tercera', async () => {
    const r = respuestas(['{"a" 1}'])
    expect(await leerConGemini({ ...pedido, fetch: r.fetch })).toEqual({ json: null, finishReason: 'STOP', error: 'GEMINI_JSON_INVALIDO' })
    expect(r.llamados()).toBe(2)
  })

  it('bien a la primera: un solo llamado', async () => {
    const r = respuestas(['{"a": 1}'])
    expect((await leerConGemini({ ...pedido, fetch: r.fetch })).json).toEqual({ a: 1 })
    expect(r.llamados()).toBe(1)
  })
})
