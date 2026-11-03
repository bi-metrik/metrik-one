import { describe, expect, it } from 'vitest'
import { extraccionGemini } from './extraccion-gemini'

/** Un `fetch` que contesta, en orden, con estos textos (forma de Gemini). */
function respuestas(textos: string[]): { fetch: typeof fetch; llamados: () => number } {
  let i = 0
  const f = (async () => {
    const text = textos[Math.min(i++, textos.length - 1)]
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: {} }), { status: 200 })
  }) as typeof fetch
  return { fetch: f, llamados: () => i }
}

const pedido = { textos: ['vamos a Cartagena'], mensajes: '', campos: [], yaTiene: {}, instrucciones: 'x' }

describe('extraccionGemini (arnés): un JSON roto se pide una vez más, como en producción', () => {
  it('a la segunda sale bien (a-choque, a-pdf-tanda, c1-1009: «el arnés falló: SyntaxError…»)', async () => {
    const r = respuestas(['{"valores" {}}', '{"valores": {}}'])
    expect(await extraccionGemini('', [], { fetch: r.fetch, modelo: 'm' })(pedido)).toEqual({ valores: {} })
    expect(r.llamados()).toBe(2)
  })

  it('roto las dos veces: lanza (y el núcleo lo vuelve un candado)', async () => {
    const r = respuestas(['{"a" 1}'])
    await expect(extraccionGemini('', [], { fetch: r.fetch, modelo: 'm' })(pedido)).rejects.toBeInstanceOf(SyntaxError)
    expect(r.llamados()).toBe(2)
  })
})
