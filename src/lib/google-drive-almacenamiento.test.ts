import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Un workspace con almacenamiento externo NO puede hablar con Drive por ninguna vía:
// ni con sus credenciales ni cayendo a las globales de MeTRIK. Se prueba en el punto
// por donde pasa TODA operación de `google-drive.ts` (el token), con un control que
// sí debe llegar a Google para que un "no llamó a fetch" signifique algo.

let configExtra: Record<string, unknown> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    // Vault (#717): sin secretos guardados, las credenciales salen de config_extra.
    rpc: async () => ({ data: {}, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { slug: 'trappvel', config_extra: configExtra }, error: null }),
        }),
      }),
    }),
  }),
}))

import { createDriveFolder, getAccessToken, uploadFileToDrive } from './google-drive'

const fetchFalso = vi.fn(async (url: string) => {
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
  }
  return new Response('{}', { status: 200 })
})

beforeEach(() => {
  fetchFalso.mockClear()
  vi.stubGlobal('fetch', fetchFalso)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Drive cerrado para almacenamiento externo', () => {
  it('supabase_externo: el token se niega y Google no recibe ninguna llamada', async () => {
    configExtra = { storage_provider: 'supabase_externo', storage_supabase_url: 'https://x.supabase.co' }
    await expect(getAccessToken('ws-externo-1')).rejects.toThrow(/fuera de Google Drive/)
    await expect(createDriveFolder('Vouchers', 'padre', 'ws-externo-1')).rejects.toThrow(/fuera de Google Drive/)
    await expect(
      uploadFileToDrive(Buffer.from('%PDF'), 'pasaporte.pdf', 'application/pdf', 'carpeta', 'ws-externo-1'),
    ).rejects.toThrow(/fuera de Google Drive/)
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('una errata en el proveedor tampoco cae a Drive (fail-closed)', async () => {
    configExtra = { storage_provider: 'supabase-externo' }
    await expect(getAccessToken('ws-externo-2')).rejects.toThrow(/fuera de Google Drive/)
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('control: un workspace en Drive con OAuth propio sí llega a Google', async () => {
    configExtra = { drive_refresh_token: 'r', drive_client_id: 'c', drive_client_secret: 's' }
    await expect(getAccessToken('ws-drive-1')).resolves.toBe('tok')
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })
})
