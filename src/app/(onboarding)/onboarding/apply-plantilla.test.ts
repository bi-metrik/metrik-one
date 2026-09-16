/**
 * `applyPlantilla` solo configura el workspace de quien tiene la sesion, y solo en el
 * onboarding.
 *
 * El hueco (riesgo 11, segunda ronda): era `applyPlantilla(workspaceId, lineaId)`, una
 * server action registrada que no pedia sesion. Con el cliente de servicio corria
 * `apply_plantilla_to_workspace` y cambiaba `workspaces.linea_activa_id` del workspace que
 * le pasaran: cualquiera, con o sin cuenta, podia sembrar bloques y mover la linea activa
 * de un cliente ajeno.
 *
 * Lo que se fija aqui:
 *   - sin sesion no escribe nada;
 *   - el workspace sale del perfil de la sesion, nunca de un argumento (ni siquiera si un
 *     navegador viejo sigue mandando el id como primer parametro);
 *   - solo el owner, solo con una plantilla nativa y solo si el workspace aun no tiene
 *     linea activa (o sea, en el onboarding).
 *
 * EL DOBLE APLICA LOS FILTROS Y REGISTRA LA RPC Y EL UPDATE: la prueba mira que no haya
 * escritura, no solo lo que devuelve la funcion.
 *
 * VISTO FALLAR (2026-09-16):
 *   - contra `actions.ts` de `origin/main` cayeron las 7. No dice mucho por si solo: el
 *     cambio de firma tumba tambien el camino sano. Por eso la tanda que cuenta es la de
 *     mutaciones sobre el archivo nuevo, una guarda a la vez:
 *   - sin exigir owner: cae 1 (la del operador);
 *   - sin validar que la linea sea plantilla nativa: cae 1;
 *   - sin exigir que el workspace no tenga linea activa: cae 1;
 *   - sin el chequeo de sesion: cae 1, y solo por el MENSAJE. Sin ese chequeo `user.id`
 *     lanza, el try/catch lo atrapa y tampoco se escribe nada: la escritura queda
 *     protegida dos veces, y lo observable del chequeo es decirle a la persona que su
 *     sesion vencio en vez de "Error inesperado".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Fila = Record<string, unknown>

const escenario: {
  usuario: { id: string } | null
  tablas: Record<string, Fila[]>
} = { usuario: null, tablas: {} }

const rpcs: Array<{ nombre: string; args: Fila }> = []
const updates: Array<{ tabla: string; filtros: Fila; payload: Fila }> = []

vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: escenario.usuario, error: null }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (tabla: string) => constructor(tabla),
    rpc: async (nombre: string, args: Fila) => {
      rpcs.push({ nombre, args })
      return { error: null }
    },
  }),
}))

function constructor(tabla: string) {
  const eqs: Fila = {}
  const nulos: string[] = []
  let payload: Fila | null = null

  const filtradas = () =>
    (escenario.tablas[tabla] ?? []).filter(
      (f) =>
        Object.entries(eqs).every(([c, v]) => f[c] === v) &&
        nulos.every((c) => f[c] === null || f[c] === undefined),
    )

  const q = {
    select: () => q,
    order: () => q,
    eq: (columna: string, valor: unknown) => {
      eqs[columna] = valor
      return q
    },
    is: (columna: string, valor: unknown) => {
      if (valor === null) nulos.push(columna)
      return q
    },
    update: (p: Fila) => {
      payload = p
      return q
    },
    maybeSingle: async () => ({ data: filtradas()[0] ?? null, error: null }),
    single: async () => ({ data: filtradas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (payload) {
        updates.push({ tabla, filtros: { ...eqs }, payload })
        return Promise.resolve({ error: null }).then(ok, ko)
      }
      return Promise.resolve({ data: filtradas(), error: null }).then(ok, ko)
    },
  }
  return q
}

import { applyPlantilla } from './actions'

// Firma vieja, para simular un navegador con el bundle anterior o una llamada directa.
const applyPlantillaCrudo = applyPlantilla as unknown as (...args: unknown[]) => Promise<{ success: boolean; error?: string }>

function sembrar() {
  escenario.usuario = { id: 'user-nuevo' }
  escenario.tablas = {
    profiles: [
      { id: 'user-nuevo', workspace_id: 'ws-nuevo', role: 'owner' },
      { id: 'user-operador', workspace_id: 'ws-nuevo', role: 'operator' },
    ],
    lineas_negocio: [
      { id: 'linea-plantilla', tipo: 'plantilla', workspace_id: null },
      { id: 'linea-de-otro-cliente', tipo: 'clarity', workspace_id: 'ws-ajeno' },
    ],
    workspaces: [
      { id: 'ws-nuevo', linea_activa_id: null },
      { id: 'ws-ajeno', linea_activa_id: 'linea-de-otro-cliente' },
    ],
  }
}

beforeEach(() => {
  rpcs.length = 0
  updates.length = 0
  sembrar()
})

describe('applyPlantilla — sesion y workspace', () => {
  it('el owner del workspace recien creado aplica una plantilla nativa', async () => {
    const r = await applyPlantilla('linea-plantilla')
    expect(r).toEqual({ success: true })
    expect(rpcs).toEqual([
      { nombre: 'apply_plantilla_to_workspace', args: { p_workspace_id: 'ws-nuevo', p_linea_id: 'linea-plantilla' } },
    ])
    expect(updates).toEqual([
      { tabla: 'workspaces', filtros: { id: 'ws-nuevo' }, payload: { linea_activa_id: 'linea-plantilla' } },
    ])
  })

  it('sin sesion no escribe nada', async () => {
    escenario.usuario = null
    const r = await applyPlantilla('linea-plantilla')
    expect(r).toEqual({ success: false, error: 'Sesión expirada. Inicia sesión de nuevo.' })
    expect(rpcs).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('un workspace ajeno pasado por el navegador no se toca', async () => {
    await applyPlantillaCrudo('ws-ajeno', 'linea-plantilla')
    const tocados = [
      ...rpcs.map((r) => r.args.p_workspace_id),
      ...updates.map((u) => u.filtros.id),
    ]
    expect(tocados).not.toContain('ws-ajeno')
  })

  it('un usuario que no es owner no configura el workspace', async () => {
    escenario.usuario = { id: 'user-operador' }
    const r = await applyPlantilla('linea-plantilla')
    expect(r.success).toBe(false)
    expect(rpcs).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('una linea que no es plantilla nativa no se aplica', async () => {
    const r = await applyPlantilla('linea-de-otro-cliente')
    expect(r.success).toBe(false)
    expect(rpcs).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('un workspace que ya tiene linea activa no se reconfigura', async () => {
    escenario.tablas.workspaces[0].linea_activa_id = 'linea-plantilla'
    const r = await applyPlantilla('linea-plantilla')
    expect(r.success).toBe(false)
    expect(rpcs).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('un usuario sin perfil no escribe nada', async () => {
    escenario.usuario = { id: 'user-sin-perfil' }
    const r = await applyPlantilla('linea-plantilla')
    expect(r.success).toBe(false)
    expect(rpcs).toHaveLength(0)
  })
})
