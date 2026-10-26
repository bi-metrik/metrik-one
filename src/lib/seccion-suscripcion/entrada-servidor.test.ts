/**
 * La entrada de `/suscripcion`: el CDA sigue entrando por la puerta de Valida, sin cambio; un cliente
 * de Clarity que paga su licencia de ONE entra por `mis_servicios()`, sin términos que aceptar; y
 * nadie más.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = 'b4d2ace9-7141-49a6-a34e-53461b55c85b'
const SC = '11111111-1111-4111-8111-111111111111'
const OMAR = '64864a69-f5b5-4f33-96bf-99fe2b3bbe4c'

const escenario: {
  valida: Record<string, unknown>
  servicios: { data: unknown[] | null; error: { message: string; code?: string } | null }
  usuario: { id: string } | null
} = { valida: { tipo: 'sin_modulo' }, servicios: { data: [], error: null }, usuario: { id: OMAR } }

const rpc = vi.fn(async (_fn: string) => escenario.servicios)

vi.mock('@/lib/valida-cda/puerta', () => ({ entradaValidaCda: async () => escenario.valida }))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: escenario.usuario }) }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: { rpc }, workspaceId: WS, role: 'owner', userId: OMAR, impersonating: false }),
}))

// `cache` de React no memoiza fuera de un request de servidor: cada llamada resuelve de nuevo.
const { entradaSuscripcion } = await import('./entrada-servidor')

const contratoClarity = {
  servicio_contratado_id: SC,
  modulo: 'business',
  estado: 'activo',
  es_pagador: true,
  vigente_desde: '2026-09-05',
}

beforeEach(() => {
  escenario.valida = { tipo: 'sin_modulo' }
  escenario.servicios = { data: [], error: null }
  escenario.usuario = { id: OMAR }
  rpc.mockClear()
})

describe('entrada de /suscripcion', () => {
  it('un CDA que paga su contrato entra por la puerta de Valida, tal cual, sin leer nada más', async () => {
    escenario.valida = { tipo: 'ok', estado: { estado: 'pendiente' }, servicioContratadoId: 'sc-cda', workspaceId: 'ws-cda' }
    const e = await entradaSuscripcion()
    expect(e).toMatchObject({
      tipo: 'ok',
      producto: 'valida_cda',
      entrada: { servicioContratadoId: 'sc-cda', estado: { estado: 'pendiente' } },
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('la puerta de Valida caída cierra la sección', async () => {
    escenario.valida = { tipo: 'no_disponible' }
    expect(await entradaSuscripcion()).toEqual({ tipo: 'no_disponible' })
  })

  it('un cliente de Clarity que paga su licencia de ONE: entra, sin términos que aceptar', async () => {
    escenario.servicios = { data: [contratoClarity], error: null }
    const e = await entradaSuscripcion()
    expect(e).toMatchObject({
      tipo: 'ok',
      producto: 'one',
      entrada: {
        tipo: 'ok',
        workspaceId: WS,
        usuarioId: OMAR,
        usuarioEfectivoId: OMAR,
        impersonando: false,
        estado: { estado: 'aprobada' },
        servicioContratadoId: SC,
        plazoTerminos: null,
        enPlazo: false,
      },
    })
    expect(rpc).toHaveBeenCalledWith('mis_servicios')
  })

  it('un espacio de Clarity sin contrato que pague (SOENA, metrik): no aplica', async () => {
    escenario.servicios = { data: [{ ...contratoClarity, es_pagador: false }], error: null }
    expect(await entradaSuscripcion()).toEqual({ tipo: 'no_aplica' })
    escenario.servicios = { data: [], error: null }
    expect(await entradaSuscripcion()).toEqual({ tipo: 'no_aplica' })
  })

  it('no poder leer los contratos no es «sin contrato»: no disponible', async () => {
    escenario.servicios = { data: null, error: { message: 'boom' } }
    expect(await entradaSuscripcion()).toEqual({ tipo: 'no_disponible' })
  })

  it('sin sesión, nada', async () => {
    escenario.valida = { tipo: 'sin_sesion' }
    expect(await entradaSuscripcion()).toEqual({ tipo: 'no_aplica' })
    escenario.valida = { tipo: 'sin_modulo' }
    escenario.usuario = null
    expect(await entradaSuscripcion()).toEqual({ tipo: 'no_aplica' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
