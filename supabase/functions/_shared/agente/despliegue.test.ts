import { afterEach, describe, expect, it } from 'vitest'
import { conDespliegue, despliegue } from './despliegue'

/** El despliegue en la traza (encargo 2026-10-30): `DENO_DEPLOYMENT_ID` en Supabase; fuera de él, nada. */

const g = globalThis as { Deno?: unknown }
afterEach(() => { delete g.Deno })

describe('despliegue', () => {
  it('fuera de Supabase no hay despliegue y la traza queda igual', () => {
    expect(despliegue()).toBeNull()
    const t = { tipo: 'modelo', bot: 'one' }
    expect(conDespliegue(t)).toEqual(t)
  })
  it('en Supabase la traza lleva la versión del despliegue', () => {
    g.Deno = { env: { get: (k: string) => (k === 'DENO_DEPLOYMENT_ID' ? 'yfjq_abc_244' : undefined) } }
    expect(conDespliegue({ tipo: 'modelo' })).toEqual({ tipo: 'modelo', despliegue: 'yfjq_abc_244' })
  })
  it('sin permiso de entorno no rompe el turno', () => {
    g.Deno = { env: { get: () => { throw new Error('NotCapable') } } }
    expect(despliegue()).toBeNull()
  })
})
