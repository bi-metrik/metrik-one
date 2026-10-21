import { describe, expect, it } from 'vitest'
import { cuerpoAnthropicDesdeGemini, URL_ANTHROPIC } from '../../llm-anthropic'
import { cuerpoLectura, jsonDeRespuesta, lectorDeSoportes, normalizarLectura, sePuedeLeer } from './lectura-adjunto'
import { reciboUberSintetico } from '../arnes/soportes/pdf-minimo'

/** La lectura del soporte (foto o PDF): el pedido, el saneo y los dos proveedores (Haiku principal, Gemini respaldo). */

const PDF = { bytes: reciboUberSintetico(), mime: 'application/pdf', nombre: 'recibo-uber.pdf' }
const JPG = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg' }
const LEIDO = { legible: true, monto: 6880, fecha: '2026-10-21', comercio: 'Uber', nit: null, numero_transaccion: null, descripcion: 'viaje de Carrera 7 a Calle 26' }

const respuesta = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })
const respuestaGemini = (j: unknown) => respuesta({ candidates: [{ content: { parts: [{ text: JSON.stringify(j) }] }, finishReason: 'STOP' }] })
const respuestaAnthropic = (j: unknown) => respuesta({ model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify(j) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } })

describe('el pedido de lectura', () => {
  it('lleva el archivo en inlineData (forma de Gemini) y pide JSON con esquema', () => {
    const c = cuerpoLectura(PDF) as { contents: Array<{ parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> }>; generationConfig: Record<string, unknown> }
    const inline = c.contents[0].parts[0].inlineData!
    expect(inline.mimeType).toBe('application/pdf')
    expect(atob(inline.data).startsWith('%PDF-1.4')).toBe(true)
    expect(c.contents[0].parts[1].text).toContain('recibo-uber.pdf')
    expect(c.generationConfig.responseMimeType).toBe('application/json')
  })

  it('traducido a Haiku: el PDF es un bloque `document` y la foto un bloque `image`, con salida estructurada', () => {
    const tp = cuerpoAnthropicDesdeGemini(cuerpoLectura(PDF))
    expect(tp.ok).toBe(true)
    const bp = (tp as { cuerpo: { messages: Array<{ content: Array<Record<string, unknown>> }>; output_config?: Record<string, unknown> } }).cuerpo
    expect(bp.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } })
    expect(bp.output_config?.format).toMatchObject({ type: 'json_schema' })
    const ti = cuerpoAnthropicDesdeGemini(cuerpoLectura(JPG))
    expect((ti as { cuerpo: { messages: Array<{ content: Array<Record<string, unknown>> }> } }).cuerpo.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } })
  })

  it('solo PDF e imágenes se leen', () => {
    expect(sePuedeLeer('application/pdf')).toBe(true)
    expect(sePuedeLeer('image/heic')).toBe(true)
    expect(sePuedeLeer('application/vnd.ms-excel')).toBe(false)
  })
})

describe('normalizarLectura', () => {
  it('monto entero positivo, fecha real AAAA-MM-DD, textos cortos', () => {
    expect(normalizarLectura({ legible: true, monto: 6880.4, fecha: '2026-10-21', comercio: '  Uber  ', nit: 'NIT 900.123.456-7', descripcion: 'viaje' }))
      .toEqual({ legible: true, monto: 6880, fecha: '2026-10-21', comercio: 'Uber', nit: '900123456-7', numero_transaccion: null, descripcion: 'viaje' })
    expect(normalizarLectura({ legible: true, monto: '6880', fecha: '21/10/2026' })).toMatchObject({ monto: 6880, fecha: null })
  })

  it('sin monto no es legible; basura no rompe', () => {
    expect(normalizarLectura({ legible: true, monto: 0 })).toMatchObject({ legible: false, monto: null })
    expect(normalizarLectura({ legible: true, monto: -5 })).toMatchObject({ legible: false })
    expect(normalizarLectura(null)).toMatchObject({ legible: false, monto: null, fecha: null, comercio: null })
    expect(normalizarLectura({ legible: false, monto: 6880 })).toMatchObject({ legible: false, monto: 6880 })
  })

  it('jsonDeRespuesta quita cercas y descarta lo que no es JSON', () => {
    expect(jsonDeRespuesta({ candidates: [{ content: { parts: [{ text: '```json\n{"monto": 1}\n```' }] } }] })).toEqual({ monto: 1 })
    expect(jsonDeRespuesta({ candidates: [{ content: { parts: [{ text: 'no sé' }] } }] })).toBeNull()
    expect(jsonDeRespuesta({})).toBeNull()
  })
})

describe('lectorDeSoportes', () => {
  const conHaiku = (k: string) => ({ ANTHROPIC_API_KEY: 'sk-prueba' } as Record<string, string>)[k]

  it('con Haiku activo, el PDF va a Anthropic y vuelve la lectura saneada', async () => {
    const urls: string[] = []
    const f = (async (u: RequestInfo | URL) => {
      urls.push(String(u))
      return respuestaAnthropic(LEIDO)
    }) as typeof fetch
    const leer = lectorDeSoportes({ llaveGemini: 'g', fetch: f, entorno: conHaiku })
    expect(await leer(PDF)).toEqual(LEIDO)
    expect(urls).toEqual([URL_ANTHROPIC])
  })

  it('si Haiku falla (529), el MISMO pedido va a Gemini con el archivo en inlineData', async () => {
    const pedidos: Array<{ url: string; cuerpo: string }> = []
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      pedidos.push({ url: String(u), cuerpo: String(init?.body ?? '') })
      return String(u) === URL_ANTHROPIC ? respuesta({ error: { message: 'overloaded' } }, 529) : respuestaGemini(LEIDO)
    }) as typeof fetch
    const leer = lectorDeSoportes({ llaveGemini: 'g', fetch: f, entorno: conHaiku })
    expect(await leer(PDF)).toEqual(LEIDO)
    expect(pedidos.map((p) => p.url.includes('generativelanguage'))).toEqual([false, true])
    expect(JSON.parse(pedidos[1].cuerpo).contents[0].parts[0].inlineData.mimeType).toBe('application/pdf')
  })

  it('con `LLM_PROVEEDOR_SOPORTES=gemini` lee directo en Gemini', async () => {
    const urls: string[] = []
    const f = (async (u: RequestInfo | URL) => {
      urls.push(String(u))
      return respuestaGemini(LEIDO)
    }) as typeof fetch
    const leer = lectorDeSoportes({ llaveGemini: 'g', fetch: f, entorno: (k) => ({ ANTHROPIC_API_KEY: 'sk', LLM_PROVEEDOR_SOPORTES: 'gemini' } as Record<string, string>)[k] })
    expect(await leer(JPG)).toEqual(LEIDO)
    expect(urls[0]).toContain('generativelanguage.googleapis.com')
  })

  it('si nadie lee (error, red, tipo raro), devuelve null y no lanza', async () => {
    const malo = (async () => respuesta({ error: { message: 'x' } }, 400)) as typeof fetch
    expect(await lectorDeSoportes({ llaveGemini: 'g', fetch: malo, entorno: () => undefined })(PDF)).toBeNull()
    const caido = (async () => { throw new Error('sin red') }) as typeof fetch
    expect(await lectorDeSoportes({ llaveGemini: 'g', fetch: caido, entorno: () => undefined })(PDF)).toBeNull()
    expect(await lectorDeSoportes({ llaveGemini: 'g', fetch: caido, entorno: () => undefined })({ bytes: new Uint8Array([1]), mime: 'application/zip' })).toBeNull()
  })
})

describe('normalizarLectura · número de la transacción (C1)', () => {
  it('lo deja en dígitos y letras; vacío es null', () => {
    expect(normalizarLectura({ legible: true, monto: 1850000, fecha: '2026-10-20', numero_transaccion: ' 0004-587 123 ' }).numero_transaccion).toBe('0004587123');
    expect(normalizarLectura({ legible: true, monto: 1850000, fecha: '2026-10-20', numero_transaccion: '' }).numero_transaccion).toBeNull();
  });
});
