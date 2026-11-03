import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))

import { pasarelaDelWorkspace } from './pasarela-servidor'

afterEach(() => vi.unstubAllEnvs())

describe('pasarelaDelWorkspace', () => {
  it('NUNCA cae a la llave de MéTRIK: sin llaves en la bóveda devuelve null y no llama a Bold', async () => {
    vi.stubEnv('BOLD_IDENTITY_KEY', 'metrik-identidad-ZZZZ9999')
    vi.stubEnv('BOLD_SECRET_KEY', 'metrik-secreta-ZZZZ9999')
    const f = vi.fn()
    const cliente = { rpc: vi.fn(async () => ({ data: {}, error: null })) }
    expect(await pasarelaDelWorkspace('4d0a0f45-7425-4d4d-8495-cc78cdd5cf92', { cliente, fetch: f as unknown as typeof fetch })).toBeNull()
    expect(cliente.rpc).toHaveBeenCalledWith('leer_secretos_workspace', { p_workspace_id: '4d0a0f45-7425-4d4d-8495-cc78cdd5cf92' })
    expect(f).not.toHaveBeenCalled()
  })

  it('con llaves en la bóveda arma la pasarela del workspace', async () => {
    const cliente = { rpc: vi.fn(async () => ({ data: { bold_identity_key: 'ws-identidad-AAAA1111' }, error: null })) }
    expect(await pasarelaDelWorkspace('ws', { cliente })).not.toBeNull()
  })
})
