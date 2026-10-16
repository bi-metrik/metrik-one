/**
 * `?ws=` en `/api/crons/valida-cobro-prueba`: procesa SOLO ese espacio; uno que no existe responde 404 y
 * no procesa nada (nunca cae a «todos»).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const llamadas: { soloWorkspaceId?: string }[] = []
vi.mock('@/lib/valida-registro/cobro-prueba-servidor', () => ({
  procesarCobrosTrasPrueba: async (d: { soloWorkspaceId?: string }) => {
    llamadas.push({ soloWorkspaceId: d.soloWorkspaceId })
    return { avisos: 0 }
  },
}))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: null }) }))
const ESPACIOS = [{ id: '2960e49c-028f-48fa-af30-f7073b68743c', slug: 'cda-pruebas-futuras' }]
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (c: 'id' | 'slug', v: string) => ({
          maybeSingle: async () => ({ data: ESPACIOS.find((e) => e[c] === v) ?? null, error: null }),
        }),
      }),
    }),
  }),
}))

const { GET } = await import('./route')

const pedir = (q = '') => GET(new NextRequest(`https://x.metrikone.co/api/crons/valida-cobro-prueba${q}`, { headers: { authorization: 'Bearer s3creto' } }))

beforeEach(() => {
  llamadas.length = 0
  process.env.CRON_SECRET = 's3creto'
})

describe('el filtro ?ws=', () => {
  it('por slug o por id: procesa solo ese espacio', async () => {
    const r = await pedir('?ws=cda-pruebas-futuras')
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, ws: 'cda-pruebas-futuras', workspace_id: ESPACIOS[0].id })
    await pedir(`?ws=${ESPACIOS[0].id}`)
    expect(llamadas).toEqual([{ soloWorkspaceId: ESPACIOS[0].id }, { soloWorkspaceId: ESPACIOS[0].id }])
  })

  it('un espacio que no existe: 404 y no procesa nada', async () => {
    const r = await pedir('?ws=test-de-pruebaz')
    expect(r.status).toBe(404)
    expect(llamadas).toEqual([])
  })

  it('sin filtro, todos los del despliegue, como siempre; sin autorización, 401', async () => {
    await pedir()
    expect(llamadas).toEqual([{ soloWorkspaceId: undefined }])
    const sin = await GET(new NextRequest('https://x.metrikone.co/api/crons/valida-cobro-prueba?ws=cda-pruebas-futuras'))
    expect(sin.status).toBe(401)
    expect(llamadas).toHaveLength(1)
  })
})
