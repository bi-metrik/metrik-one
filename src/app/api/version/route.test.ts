import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/version/build', () => ({ versionDelBuild: () => 'dpl_vivo' }))

import { GET } from './route'
import { EPOCA } from '@/lib/version/epoca'
import { leerEpoca } from '@/lib/version/decidir'

describe('GET /api/version', () => {
  it('publica la epoca viva (la que decide la recarga) y la version (diagnostico)', async () => {
    const res = await GET()
    const cuerpo = await res.json()
    expect(cuerpo).toEqual({ version: 'dpl_vivo', epoca: EPOCA })
    // Lo que publica el servidor es justo lo que el vigilante sabe leer.
    expect(leerEpoca(cuerpo)).toBe(EPOCA)
  })

  it('no se cachea: si se cacheara, la pestaña no veria nunca una epoca nueva', async () => {
    const res = await GET()
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('la epoca es un entero no negativo', () => {
    expect(Number.isSafeInteger(EPOCA) && EPOCA >= 0).toBe(true)
  })
})
