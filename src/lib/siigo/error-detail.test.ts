/**
 * El error de Siigo llega con el campo que rechazaron, no solo con el genérico.
 *
 * EL CASO QUE IMPORTA: Siigo usa `Message` para textos que no se pueden accionar
 * ("Your request could not be completed with the data you submitted. Please verify") y
 * pone en `Detail` el dato real que falló. Hasta el 2026-09-07 ONE descartaba `Detail`,
 * así que el fallo del recibo de V0437 llegó a la pantalla sin nada que investigar.
 *
 * SE VIO FALLAR contra la implementación anterior:
 *   - "el Detail de Siigo llega al mensaje" → el mensaje se quedaba en el genérico
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const WS = 'ws-soena'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              slug: 'soena',
              config_extra: {
                siigo_username: 'u@soena.com',
                siigo_access_key: 'k',
                siigo_partner_id: 'MetrikOne',
                siigo_config: {},
              },
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))

import { siigoRequest, SiigoError } from './client'

const fetchOriginal = global.fetch

function responder(cuerpoError: unknown) {
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/auth')) {
      return new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
    }
    return new Response(JSON.stringify(cuerpoError), { status: 400 })
  }) as unknown as typeof fetch
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { global.fetch = fetchOriginal })

describe('describirError — el Detail de Siigo no se descarta', () => {
  it('el Detail llega al mensaje cuando dice algo que el Message no dice', async () => {
    responder({
      Status: 400,
      Errors: [{
        Code: 'invalid_data',
        Message: 'Your request could not be completed with the data you submitted. Please verify',
        Detail: 'The date is out of the accounting period',
      }],
    })

    await expect(siigoRequest(WS, '/v1/vouchers', { method: 'POST', body: {} }))
      .rejects.toThrow(/The date is out of the accounting period/)
  })

  it('no repite el texto cuando Siigo manda el mismo valor en Message y Detail', async () => {
    responder({
      Status: 400,
      Errors: [{ Code: 'x', Message: 'Customer not found', Detail: 'Customer not found' }],
    })

    try {
      await siigoRequest(WS, '/v1/vouchers', { method: 'POST', body: {} })
      throw new Error('debió fallar')
    } catch (e) {
      expect(e).toBeInstanceOf(SiigoError)
      expect((e as SiigoError).message).toBe('Customer not found')
    }
  })

  it('sin Detail el mensaje sigue siendo el de antes', async () => {
    responder({ Status: 400, Errors: [{ Code: 'x', Message: 'Customer not found' }] })

    await expect(siigoRequest(WS, '/v1/vouchers', { method: 'POST', body: {} }))
      .rejects.toThrow('Customer not found')
  })
})
