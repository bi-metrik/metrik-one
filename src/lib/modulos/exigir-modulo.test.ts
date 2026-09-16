/**
 * La puerta de módulo del lado del servidor: qué lee, contra qué workspace y qué hace si no
 * puede leer.
 *
 * Lo que se fija:
 *   - los módulos son los del workspace de la SESIÓN (el doble aplica los `.eq()`: un
 *     workspace ajeno con el módulo encendido no le presta el suyo a nadie);
 *   - el platform admin es el de la persona con la sesión real;
 *   - un fallo de lectura CIERRA (al revés que el middleware).
 *
 * VISTO FALLAR (2026-09-16), mutando `exigir-modulo.ts` una guarda a la vez:
 *   - leyendo `modules` sin filtrar por el workspace de la sesión: cae 1;
 *   - dejando pasar cuando la lectura falla: caen 2;
 *   - sin la guarda de sesión: cae 1.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Fila = Record<string, unknown>

const WS = 'ws-4dsoft'
const OTRO_WS = 'ws-soena'

const escenario: {
  workspaceId: string | null
  userId: string | null
  tablas: Record<string, Fila[]>
  fallaLectura: boolean
} = { workspaceId: WS, userId: 'user-1', tablas: {}, fallaLectura: false }

function servicio() {
  return {
    from: (tabla: string) => {
      const eqs: Fila = {}
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          eqs[c] = v
          return q
        },
        maybeSingle: async () => {
          if (escenario.fallaLectura) return { data: null, error: { message: 'corte de red' } }
          const filas = (escenario.tablas[tabla] ?? []).filter((f) =>
            Object.entries(eqs).every(([c, v]) => f[c] === v),
          )
          return { data: filas[0] ?? null, error: null }
        },
      }
      return q
    },
  }
}

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: escenario.workspaceId,
    error: escenario.workspaceId ? null : 'No autenticado',
  }),
}))
vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: escenario.userId ? { id: escenario.userId } : null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => servicio() }))

// `cache()` de React deduplica por request; en la prueba cada caso es un request nuevo.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}))

import { exigirModulo, REQUISITO } from './exigir-modulo'

beforeEach(() => {
  escenario.workspaceId = WS
  escenario.userId = 'user-1'
  escenario.fallaLectura = false
  escenario.tablas = {
    workspaces: [
      { id: WS, modules: { valida_api: true } },
      { id: OTRO_WS, modules: { business: true, fab_pago_epayco: true, compliance: true, valida_consulta: true } },
    ],
    profiles: [{ id: 'user-1', platform_admin: false }],
  }
})

describe('exigirModulo', () => {
  it('sin sesión no autoriza', async () => {
    escenario.workspaceId = null
    expect(await exigirModulo(REQUISITO.validaConsulta)).toEqual({ ok: false, error: 'no_autenticado' })
  })

  it('lee los módulos del workspace de la sesión, no los de otro', async () => {
    expect(await exigirModulo(REQUISITO.pagoEpayco)).toEqual({ ok: false, error: 'modulo_no_activo' })
    expect(await exigirModulo(REQUISITO.validaConsulta)).toEqual({ ok: false, error: 'modulo_no_activo' })
  })

  it('con el módulo encendido autoriza y devuelve el workspace', async () => {
    escenario.workspaceId = OTRO_WS
    expect(await exigirModulo(REQUISITO.pagoEpayco)).toEqual({ ok: true, workspaceId: OTRO_WS })
  })

  it('el platform admin de la sesión pasa', async () => {
    escenario.tablas.profiles = [{ id: 'user-1', platform_admin: true }]
    expect(await exigirModulo(REQUISITO.sustentaDual)).toEqual({ ok: true, workspaceId: WS })
  })

  it('si no puede leer, cierra', async () => {
    escenario.fallaLectura = true
    escenario.tablas.profiles = [{ id: 'user-1', platform_admin: true }]
    expect(await exigirModulo(REQUISITO.clarity)).toEqual({ ok: false, error: 'lectura_fallida' })
  })

  it('un workspace que no aparece cierra: no es "sin modules = Clarity"', async () => {
    escenario.workspaceId = 'ws-inexistente'
    expect(await exigirModulo(REQUISITO.clarity)).toEqual({ ok: false, error: 'lectura_fallida' })
  })
})
