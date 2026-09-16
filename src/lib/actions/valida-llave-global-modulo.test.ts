/**
 * Las otras dos puertas a Valida con la llave GLOBAL de MeTRIK: la vinculación de
 * contrapartes y el proxy del reporte PDF de `/compliance/validacion`.
 *
 * El hueco (riesgo 11, tercera ronda):
 *   - `guardVinculacion` pedía sesión y rol, no el módulo, y sin llave propia caía a
 *     `VALIDA_API_KEY`: un owner de cualquier workspace listaba expedientes, creaba e
 *     invitaba contrapartes a nombre de MeTRIK.
 *   - `/api/compliance/valida-reporte/[id]` pedía sesión y dejaba pasar todo id sin fila local
 *     (límite deliberado para `/compliance/validacion`): con la sesión de 4D SOFT se bajaba
 *     cualquier reporte de la llave global conociendo su id.
 *
 * VISTO FALLAR (2026-09-16) contra `origin/main`: caen los 3 casos sin módulo o sin llave
 * propia; los 2 CONTROL siguen verdes. Quitando la guarda de módulo de `guardVinculacion`
 * cae 1; volviendo a poner el respaldo a la llave global, 1; sin la guarda de la ruta, 1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const llave: { delWorkspace: string | undefined } = { delWorkspace: 'llave-de-alma' }
const fetchValida = vi.fn(async (_url: unknown, _init?: unknown) =>
  new Response(JSON.stringify({ total: 0, expedientes: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
)

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-1', role: 'owner', error: null }),
}))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: { id: 'user-1' } }) }))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({ data: { config_extra: {} }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      }
      return q
    },
  }),
}))
vi.mock('@/lib/secretos/workspace', () => ({
  leerSecretosWorkspace: async () => ({}),
  secretoConRespaldo: () => llave.delWorkspace,
}))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())

import { listarVinculaciones } from './compliance-vinculacion'
import { GET as reporteValida } from '@/app/api/compliance/valida-reporte/[consulta_id]/route'
import { MODULES, reiniciarModulo } from '../../../test/exigir-modulo-doble'

beforeEach(() => {
  fetchValida.mockClear()
  vi.stubGlobal('fetch', fetchValida)
  process.env.VALIDA_API_KEY = 'llave-global-de-metrik'
  llave.delWorkspace = 'llave-de-alma'
  reiniciarModulo('ws-1', { ...MODULES.almaAfi })
})

describe('vinculación de contrapartes', () => {
  it('4D SOFT, owner con sesión, no llega a Valida', async () => {
    reiniciarModulo('ws-1', { ...MODULES.cuatroDSoft })
    const r = await listarVinculaciones()
    expect(r.ok).toBe(false)
    expect(fetchValida).not.toHaveBeenCalled()
  })

  it('sin llave propia no se usa la de MeTRIK', async () => {
    llave.delWorkspace = undefined
    const r = await listarVinculaciones()
    expect(r).toEqual({ ok: false, error: 'valida_api_key_no_configurada' })
    expect(fetchValida).not.toHaveBeenCalled()
  })

  it('CONTROL — alma-afi lista con su llave', async () => {
    const r = await listarVinculaciones()
    expect(r.ok).toBe(true)
    const init = fetchValida.mock.calls[0][1] as { headers: Record<string, string> }
    expect(JSON.stringify(init.headers)).toContain('llave-de-alma')
  })
})

describe('proxy del reporte PDF de /compliance/validacion', () => {
  const pedir = (id: string) =>
    reporteValida(new Request(`https://x/api/compliance/valida-reporte/${id}`) as never, {
      params: Promise.resolve({ consulta_id: id }),
    })

  it('4D SOFT no baja un reporte de la llave global', async () => {
    reiniciarModulo('ws-1', { ...MODULES.cuatroDSoft })
    const res = await pedir('00000000-0000-4000-8000-000000000001')
    expect(res.status).toBe(403)
    expect(fetchValida).not.toHaveBeenCalled()
  })

  it('CONTROL — Sustenta sí lo baja', async () => {
    fetchValida.mockResolvedValueOnce(new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }))
    const res = await pedir('00000000-0000-4000-8000-000000000001')
    expect(res.status).toBe(200)
    expect(fetchValida).toHaveBeenCalledTimes(1)
  })
})
