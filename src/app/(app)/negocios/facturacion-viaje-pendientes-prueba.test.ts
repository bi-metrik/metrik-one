/**
 * «Emitir pendientes» (adenda Siigo) y el negocio de prueba (F8-1): la financiera real no cuenta ni
 * emite los recibos del viaje de prueba en SU Siigo; quien lo lleva sí.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]>
const emitidos: Array<{ negocioId: string; cobroId: string }> = []
const sesion = vi.hoisted(() => ({ staffId: 's-financiera' }))

function leer(f: Fila, ruta: string): unknown {
  const v = ruta.split(/->>?/).reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Fila)[k] : undefined), f)
  return ruta.includes('->>') && v != null ? String(v) : v
}

function cliente() {
  return {
    from: (tabla: string) => {
      const filtros: Array<(f: Fila) => boolean> = []
      const correr = () => ({ data: (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f))), error: null })
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros.push((f) => leer(f, c) === v); return q },
        in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(leer(f, c))); return q },
        not: (c: string) => { filtros.push((f) => leer(f, c) != null); return q },
        maybeSingle: async () => ({ data: correr().data[0] ?? null, error: null }),
        then: (r: (v: unknown) => unknown) => r(correr()),
      }
      return q
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente() }))
vi.mock('@/lib/idempotencia/accion', () => ({ accionIdempotente: (_o: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ ok: true }) }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws', staffId: sesion.staffId, role: 'operator', areas: ['financiera'] }),
}))
vi.mock('@/lib/viaje/riel-cobro-datos', () => ({
  emitirReciboViaje: async (a: { negocioId: string; cobroId: string }) => { emitidos.push(a); return { numero: 'RC-1' } },
}))

const { contarPendientesSiigoViaje, emitirPendientesSiigoViaje } = await import('./facturacion-viaje-actions')

beforeEach(() => {
  emitidos.length = 0
  sesion.staffId = 's-financiera'
  tablas = {
    negocios: [
      { id: 'n-real', workspace_id: 'ws', linea_id: 'l-real', metadata: { recibos_viaje: { 'c-1': { pendiente: true } } } },
      {
        id: 'n-prueba', workspace_id: 'ws', linea_id: 'l-clon',
        metadata: { es_prueba: true, recibos_viaje: { 'c-2': { pendiente: true } } },
        negocio_responsables: [{ staff_id: 's-cp' }],
      },
    ],
    lineas_negocio: [{ id: 'l-real', workspace_id: 'ws', config_extra: {} }, { id: 'l-clon', workspace_id: 'ws', config_extra: {} }],
    workspaces: [{ id: 'ws', config_extra: {} }],
    staff: [],
  }
})

describe('recibos pendientes del viaje y el negocio de prueba (F8-1)', () => {
  it('la financiera real no cuenta ni emite el recibo de prueba', async () => {
    expect(await contarPendientesSiigoViaje()).toMatchObject({ ok: true, recibos: 1 })
    expect(await emitirPendientesSiigoViaje(1)).toEqual({ ok: true, emitidos: 1, siguenPendientes: 0 })
    expect(emitidos.map((e) => e.negocioId)).toEqual(['n-real'])
  })

  it('quien lleva el negocio de prueba sí lo cuenta', async () => {
    sesion.staffId = 's-cp'
    expect(await contarPendientesSiigoViaje()).toMatchObject({ ok: true, recibos: 2 })
  })
})
