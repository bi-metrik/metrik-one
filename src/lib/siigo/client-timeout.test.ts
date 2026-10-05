/**
 * Cada intento contra Siigo tiene tope (`client.ts`, 2026-10-04).
 *
 * EL CASO QUE IMPORTA: antes no había ninguno. Un Siigo que acepta la conexión y no
 * contesta dejaba la acción colgada hasta que Vercel mataba la función, y con el abono en
 * segundo plano (`segundo-plano.ts`) se comería la invocación entera sin dejar rastro.
 * Ahora falla con un `SiigoError` que dice qué llamada y cuánto esperó.
 *
 * CONTROL: un Siigo que contesta a tiempo sigue respondiendo igual.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const WS = 'ws-timeout'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    rpc: async () => ({ data: {}, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              slug: 'soena',
              config_extra: { siigo_username: 'u', siigo_access_key: 'k', siigo_partner_id: 'P' },
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))

import { siigoRequest, SiigoError, TIMEOUT_LECTURA_MS, TIMEOUT_ESCRITURA_MS } from './client'

const fetchOriginal = global.fetch
afterEach(() => { global.fetch = fetchOriginal })

/** `/auth` contesta; la llamada de negocio se cuelga hasta que la aborten. */
function siigoColgado() {
  const senales: AbortSignal[] = []
  global.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/auth')) {
      return Promise.resolve(new Response(JSON.stringify({ access_token: 't' }), { status: 200 }))
    }
    const signal = init?.signal as AbortSignal
    senales.push(signal)
    return new Promise<Response>((_res, rej) => {
      signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    })
  }) as unknown as typeof fetch
  return senales
}

describe('siigoRequest con tope por intento', () => {
  it('un Siigo que no contesta falla con SiigoError timeout, no se cuelga', async () => {
    const senales = siigoColgado()
    const err = await siigoRequest(WS, '/v1/invoices?x=1', { timeoutMs: 20 }).catch(e => e)
    expect(err).toBeInstanceOf(SiigoError)
    expect((err as SiigoError).codes).toEqual(['timeout'])
    expect((err as SiigoError).message).toMatch(/GET \/v1\/invoices/)
    expect(senales[0].aborted).toBe(true)
  })

  it('CONTROL — si contesta a tiempo, la respuesta llega igual', async () => {
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 })
    }) as unknown as typeof fetch
    await expect(siigoRequest(WS, '/v1/x', { timeoutMs: 1000 })).resolves.toEqual({ ok: 1 })
  })

  it('el tope por defecto: lectura más corta que escritura', () => {
    expect(TIMEOUT_LECTURA_MS).toBeGreaterThan(0)
    expect(TIMEOUT_ESCRITURA_MS).toBeGreaterThan(TIMEOUT_LECTURA_MS)
  })
})
