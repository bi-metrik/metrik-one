/**
 * Encender Siigo no vacía la cola sola (adenda Siigo): «Emitir pendientes» emite en lote SOLO con
 * el conteo confirmado, y solo la financiera o la dirección.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>
let negocios: Fila[] = []
let rol = 'owner'
let areas: string[] = []
const emitidos: string[] = []

function cliente() {
  return {
    from: (tabla: string) => {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        in: () => api,
        not: () => api,
        maybeSingle: async () => ({ data: tabla === 'workspaces' ? { config_extra: { siigo_config: { entorno: 'pruebas' } } } : null, error: null }),
        then: (r: (v: unknown) => unknown) => r({ data: tabla === 'negocios' ? negocios : [], error: null }),
      }
      return api
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente() }))
vi.mock('@/lib/idempotencia/accion', () => ({ accionIdempotente: (_o: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws', staffId: 's1', role: rol, areas, error: null }),
}))
vi.mock('@/lib/viaje/riel-cobro-datos', () => ({
  emitirReciboViaje: async (a: { cobroId: string }) => { emitidos.push(a.cobroId); return { numero: `RC-${a.cobroId}`, pendiente: null } },
}))
vi.mock('@/lib/viaje/contexto-viaje', () => ({ contextoViaje: async () => ({ ok: false, error: 'no usado' }) }))

const { contarPendientesSiigoViaje, emitirPendientesSiigoViaje } = await import('./facturacion-viaje-actions')

beforeEach(() => {
  rol = 'owner'
  areas = []
  emitidos.length = 0
  negocios = [
    { id: 'n1', linea_id: 'l', metadata: { recibos_viaje: { c1: { motivo: 'Siigo no está conectado' }, c2: { motivo: 'x' } } } },
    { id: 'n2', linea_id: 'l', metadata: { recibos_viaje: { c3: { motivo: 'x' } } } },
  ]
})

describe('Emitir pendientes', () => {
  it('cuenta los pendientes y el entorno', async () => {
    expect(await contarPendientesSiigoViaje()).toEqual({ ok: true, recibos: 3, entorno: 'pruebas' })
  })

  it('sin la confirmación del conteo no emite nada', async () => {
    expect(await emitirPendientesSiigoViaje(undefined as unknown as number)).toMatchObject({ ok: false, conteo: 3 })
    expect(await emitirPendientesSiigoViaje(2)).toMatchObject({ ok: false, error: 'Ahora hay 3 recibos pendientes. Confirma de nuevo.', conteo: 3 })
    expect(emitidos).toEqual([])
  })

  it('con el conteo confirmado emite uno por cobro', async () => {
    expect(await emitirPendientesSiigoViaje(3)).toEqual({ ok: true, emitidos: 3, siguenPendientes: 0 })
    expect(emitidos).toEqual(['c1', 'c2', 'c3'])
  })

  it('una comercial no puede; la financiera sí', async () => {
    rol = 'operator'
    areas = ['comercial']
    expect(await emitirPendientesSiigoViaje(3)).toMatchObject({ ok: false })
    expect(emitidos).toEqual([])
    areas = ['financiera']
    expect(await emitirPendientesSiigoViaje(3)).toMatchObject({ ok: true })
  })
})
