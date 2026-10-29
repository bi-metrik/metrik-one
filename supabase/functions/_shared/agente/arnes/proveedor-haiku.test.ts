import { afterEach, describe, expect, it } from 'vitest'
import { URL_ANTHROPIC } from '../../llm-anthropic'
import { CONFIG_POR_DEFECTO } from '../config'
import { escenario } from '../escenario'
import { modeloGemini } from '../modelo-gemini'
import { lectorDeSoportes } from '../one/lectura-adjunto'
import { sumarUso } from '../uso'
import { extraccionGemini } from './extraccion-gemini'
import { MODELO_HAIKU, PRECIOS_HAIKU, humoHaiku, proveedorHaiku } from './proveedor-haiku'
import { simular } from './simulador'

/**
 * El arnés con Haiku (2026-10-29, «No depende de Gemini. Corre con haiku»): el agente, el comercial simulado, la
 * extracción y los lectores van a la API de Anthropic con la llave dada, sin respaldo y sin poder salir a Gemini. Sin
 * red: un `fetch` falso hace de Anthropic.
 */

const respuesta = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })
const texto = (t: string) => respuesta({ model: MODELO_HAIKU, content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } })

interface Pedido { url: string; llave: string | null; cuerpo: Record<string, unknown> }
function anthropicFalso(responder: (c: Record<string, unknown>) => Response = () => texto('ok')) {
  const pedidos: Pedido[] = []
  const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const h = new Headers(init?.headers)
    const cuerpo = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    pedidos.push({ url: String(u), llave: h.get('x-api-key'), cuerpo })
    return responder(cuerpo)
  }) as typeof fetch
  return { f, pedidos }
}

const antes = process.env.LLM_PROVEEDOR
afterEach(() => { if (antes === undefined) delete process.env.LLM_PROVEEDOR; else process.env.LLM_PROVEEDOR = antes })

describe('proveedorHaiku', () => {
  it('un pedido con forma de Gemini va a Anthropic con la llave dada y vuelve con la forma de Gemini', async () => {
    const a = anthropicFalso()
    const h = proveedorHaiku('sk-prueba', a.f, () => {})
    const res = await h.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
      method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hola' }] }] }),
    })
    const d = await res.json()
    expect(a.pedidos.map((p) => [p.url, p.llave, p.cuerpo.model])).toEqual([[URL_ANTHROPIC, 'sk-prueba', MODELO_HAIKU]])
    expect(d.modelVersion).toBe(MODELO_HAIKU)
    expect(h.bloqueados).toEqual([])
  })

  it('LLM_PROVEEDOR=gemini en la terminal no lo devuelve a Gemini', async () => {
    process.env.LLM_PROVEEDOR = 'gemini'
    const a = anthropicFalso()
    const h = proveedorHaiku('sk-prueba', a.f, () => {})
    await h.fetch('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent', { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hola' }] }] }) })
    expect(a.pedidos.map((p) => p.url)).toEqual([URL_ANTHROPIC])
  })

  it('si Haiku falla (529) no hay respaldo: el error vuelve y nada sale a Gemini', async () => {
    const a = anthropicFalso(() => respuesta({ error: { message: 'overloaded' } }, 529))
    const h = proveedorHaiku('sk-prueba', a.f, () => {})
    const res = await h.fetch('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent', { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hola' }] }] }) })
    expect(res.status).not.toBe(200)
    expect(a.pedidos.map((p) => p.url)).toEqual([URL_ANTHROPIC])
    expect(h.bloqueados).toEqual([])
  })

  it('un pedido que no se traduce (no es generateContent) no sale: se bloquea y queda contado', async () => {
    const a = anthropicFalso()
    const h = proveedorHaiku('sk-prueba', a.f, () => {})
    await expect(h.fetch('https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent', { method: 'POST' })).rejects.toThrow('sin Gemini')
    expect(a.pedidos).toEqual([])
    expect(h.bloqueados).toEqual(['generativelanguage.googleapis.com'])
  })

  it('--humo: una sola llamada mínima, a Anthropic', async () => {
    const a = anthropicFalso()
    const r = await humoHaiku(proveedorHaiku('sk-prueba', a.f, () => {}).fetch)
    expect([r.status, r.modelo, r.cuota]).toEqual([200, MODELO_HAIKU, false])
    expect(a.pedidos).toHaveLength(1)
    expect((a.pedidos[0].cuerpo.max_tokens as number) <= 64).toBe(true)
  })
})

describe('todo el arnés por ese fetch', () => {
  it('el agente (núcleo con modeloGemini), el simulador, la extracción y el lector salen solo a Anthropic', async () => {
    const a = anthropicFalso((c) => (Array.isArray(c.tools) && c.tools.length
      ? respuesta({ model: MODELO_HAIKU, content: [{ type: 'tool_use', id: 'toolu_1', name: 'responder', input: { tema: 'solicitud', texto: '¿Me cuentas más?' } }], stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 20 } })
      : texto('{"accion":"fin","texto":""}')))
    const h = proveedorHaiku('sk-prueba', a.f, () => {})

    const modelo = modeloGemini({ llave: '', principal: { ...CONFIG_POR_DEFECTO.principal, modelo: MODELO_HAIKU }, respaldo: null, corteMs: CONFIG_POR_DEFECTO.corteMs, fetch: h.fetch, haiku: true })
    const e = await escenario({ modelo })
    const salidas = await e.escribe('hola, necesito un viaje')
    expect(salidas.map((s) => s.texto)).toEqual(['¿Me cuentas más?'])
    const uso = e.pasos.flatMap((p) => p.trazas).flatMap((t) => t.uso ?? [])
    expect(uso.map((u) => u.modelo)).toEqual([MODELO_HAIKU])

    const s = await simular({ llave: '', modelo: MODELO_HAIKU, razonamiento: null, sistema: 'eres un comercial', transcripcion: '(nada)', fetch: h.fetch })
    expect(s.ok && s.accion.accion).toBe('fin')

    await extraccionGemini('', [], { fetch: h.fetch, modelo: MODELO_HAIKU })({ textos: ['hola'], campos: [], instrucciones: 'extrae', perfil: false } as never).catch(() => null)
    await lectorDeSoportes(h.lector)({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mime: 'application/pdf', nombre: 'x.pdf' })

    expect(a.pedidos.length).toBeGreaterThanOrEqual(4)
    expect(new Set(a.pedidos.map((p) => p.url))).toEqual(new Set([URL_ANTHROPIC]))
    expect(new Set(a.pedidos.map((p) => p.llave))).toEqual(new Set(['sk-prueba']))
    expect(h.bloqueados).toEqual([])
  })
})

describe('el gasto con los precios de Haiku 5.5 (doc oficial, 2026-10-29)', () => {
  it('entrada 0,10, salida 0,50 y caché leído 0,01 USD por millón', () => {
    const u = sumarUso([{ tipo: 'modelo', bot: 'x', uso: [{ modelo: MODELO_HAIKU, entrada: 1_000_000, salida: 1_000_000, razonamiento: 0, cache: 500_000, ms: 0, ok: true }] } as never], PRECIOS_HAIKU)
    expect(u.costo_usd).toBeCloseTo(0.5 * 0.10 + 0.5 * 0.01 + 0.50, 10)
    expect(u.sin_precio).toEqual([])
  })
})
