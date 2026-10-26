import { describe, expect, it } from 'vitest'
import { PROMPT_TRANSCRIPCION_LITERAL, pedidoTranscripcion, promptConPistas } from './transcripcion'
import { transcribirAudio, PROMPT_NOTA_DE_VOZ } from './agente/publico/transcribir'

const pedido = (o: Partial<Parameters<typeof pedidoTranscripcion>[0]> = {}) => pedidoTranscripcion({
  modelo: 'gemini-2.5-flash-lite', llave: 'llave-secreta', prompt: PROMPT_TRANSCRIPCION_LITERAL, mime: 'audio/ogg', base64: 'QUJD',
  maxSalida: 8192, temperatura: 0.1, ...o,
})

describe('el pedido de transcripción a Gemini (§4.6)', () => {
  it('la llave va en la cabecera x-goog-api-key, nunca en la URL', () => {
    const { url, init } = pedido()
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent')
    expect(url).not.toContain('key=')
    expect(url).not.toContain('llave-secreta')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('llave-secreta')
    expect(String(init.body)).not.toContain('llave-secreta')
  })

  it('sin pistas, el cuerpo es byte a byte el de antes (ONE: temperatura 0.1; público: sin temperatura)', () => {
    const antes = JSON.stringify({
      contents: [{ parts: [{ text: PROMPT_TRANSCRIPCION_LITERAL }, { inline_data: { mime_type: 'audio/ogg', data: 'QUJD' } }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    })
    expect(pedido({ prompt: promptConPistas(PROMPT_TRANSCRIPCION_LITERAL, null) }).init.body).toBe(antes)
    expect(pedido({ prompt: promptConPistas(PROMPT_TRANSCRIPCION_LITERAL, '   ') }).init.body).toBe(antes)
    const publico = JSON.parse(String(pedido({ temperatura: null, maxSalida: 4096 }).init.body))
    expect(publico.generationConfig).toEqual({ maxOutputTokens: 4096 })
  })

  it('con pistas, el bloque va al final del prompt, después de una línea en blanco', () => {
    expect(promptConPistas('Transcribe.', null)).toBe('Transcribe.')
    expect(promptConPistas('Transcribe.', undefined)).toBe('Transcribe.')
    expect(promptConPistas('Transcribe.', 'Palabras que pueden aparecer: Ana')).toBe('Transcribe.\n\nPalabras que pueden aparecer: Ana')
  })
})

describe('público: las pistas llegan al prompt solo si se pasan', () => {
  const prompts: string[] = []
  const f = (async (u: string, i: RequestInit = {}) => {
    if (u.startsWith('https://generativelanguage')) prompts.push(JSON.parse(String(i.body)).contents[0].parts[0].text)
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hola' }] } }] }))
  }) as unknown as typeof fetch
  it('sin pistas, el prompt de siempre; con pistas, el bloque al final', async () => {
    const o = { llave: 'k', modelo: 'gemini-3.5-flash-lite', maxBytes: 1000, fetch: f }
    await transcribirAudio({ bytes: new Uint8Array([1, 2]), mime: 'audio/ogg' }, o)
    await transcribirAudio({ bytes: new Uint8Array([1, 2]), mime: 'audio/ogg' }, { ...o, pistas: null })
    await transcribirAudio({ bytes: new Uint8Array([1, 2]), mime: 'audio/ogg' }, { ...o, pistas: 'Palabras que pueden aparecer: Noche de Ramen' })
    expect(prompts[0]).toBe(PROMPT_NOTA_DE_VOZ)
    expect(prompts[1]).toBe(PROMPT_NOTA_DE_VOZ)
    expect(prompts[2]).toBe(`${PROMPT_NOTA_DE_VOZ}\n\nPalabras que pueden aparecer: Noche de Ramen`)
  })
})
