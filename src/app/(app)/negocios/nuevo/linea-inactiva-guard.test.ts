/**
 * «Nuevo negocio» no crea negocios en una línea apagada ni en una de otro workspace.
 *
 * La pantalla (`page.tsx`) ya listaba solo las líneas activas; la acción no lo exigía, así que
 * bastaba mandar el id de una línea con `is_active = false` (el clon de prueba de una línea que
 * se rediseña, plan post-cotización de Trappvel, F7-6) para meterle negocios.
 *
 * EL DOBLE APLICA LOS `.eq()`: una línea de otro workspace no aparece aunque el id coincida.
 * `crearNegocioEnWorkspace` se sustituye para ver si la acción llegó a crear.
 *
 * VISTO FALLAR (2026-10-12): sin la guarda caen los 3 rechazos y los 2 CONTROL siguen verdes. Sin
 * el filtro por workspace cae 1 (la ajena); con `=== false` en vez de `!== true` cae 1 (sin marca).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

const WS = '64010015-a9a2-4aca-be83-e456cf217d96'
const OTRO_WS = '0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3'
let tablas: Record<string, Fila[]> = {}

function cliente() {
  return {
    from: (tabla: string) => {
      const eqs: Fila = {}
      const filas = () => (tablas[tabla] ?? []).filter((f) => Object.entries(eqs).every(([c, v]) => f[c] === v))
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          eqs[c] = v
          return q
        },
        maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
      }
      return q
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: cliente(),
    workspaceId: WS,
    userId: 'user-1',
    staffId: 'staff-1',
    role: 'owner',
    areas: [],
    error: null,
  }),
}))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../../../test/exigir-modulo-doble')).dobleExigirModulo())

const crearNegocioEnWorkspace = vi.fn(async (..._args: unknown[]) => ({ negocio_id: 'neg-nuevo', error: null }))
vi.mock('@/lib/negocios/crear-negocio', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  crearNegocioEnWorkspace: (...args: unknown[]) => crearNegocioEnWorkspace(...args),
}))

import { crearNegocio } from '../negocio-v2-actions'
import { MODULES, reiniciarModulo } from '../../../../../test/exigir-modulo-doble'
import { ORIGENES_NEGOCIO, ORIGEN_ALIANZA } from '@/lib/catalogos/constants'

const ORIGEN = ORIGENES_NEGOCIO.find((o) => o.value !== ORIGEN_ALIANZA)!.value

beforeEach(() => {
  reiniciarModulo(WS, { ...MODULES.termotech })
  crearNegocioEnWorkspace.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  tablas = {
    lineas_negocio: [
      { id: 'linea-viva', workspace_id: WS, is_active: true },
      { id: 'linea-clon', workspace_id: WS, is_active: false },
      { id: 'linea-sin-marca', workspace_id: WS, is_active: null },
      { id: 'linea-ajena', workspace_id: OTRO_WS, is_active: true },
    ],
  }
})

describe('crearNegocio con una línea explícita', () => {
  it('una línea apagada no recibe negocios', async () => {
    const r = await crearNegocio({ nombre: 'Viaje de prueba', origen: ORIGEN, linea_id: 'linea-clon' })
    expect(r.negocio_id).toBeNull()
    expect(r.error).toMatch(/no está disponible/)
    expect(crearNegocioEnWorkspace).not.toHaveBeenCalled()
  })

  it('una línea sin marca de activa tampoco (la pantalla no la lista)', async () => {
    const r = await crearNegocio({ nombre: 'Viaje de prueba', origen: ORIGEN, linea_id: 'linea-sin-marca' })
    expect(r.negocio_id).toBeNull()
    expect(crearNegocioEnWorkspace).not.toHaveBeenCalled()
  })

  it('una línea de otro workspace tampoco, aunque esté activa', async () => {
    const r = await crearNegocio({ nombre: 'Viaje de prueba', origen: ORIGEN, linea_id: 'linea-ajena' })
    expect(r.negocio_id).toBeNull()
    expect(crearNegocioEnWorkspace).not.toHaveBeenCalled()
  })

  it('CONTROL: una línea activa del workspace crea el negocio', async () => {
    const r = await crearNegocio({ nombre: 'Viaje de prueba', origen: ORIGEN, linea_id: 'linea-viva' })
    expect(r.negocio_id).toBe('neg-nuevo')
    expect(crearNegocioEnWorkspace).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: sin línea explícita no se mira nada (entra por la línea activa del workspace)', async () => {
    const r = await crearNegocio({ nombre: 'Viaje de prueba', origen: ORIGEN })
    expect(r.negocio_id).toBe('neg-nuevo')
    expect(crearNegocioEnWorkspace).toHaveBeenCalledTimes(1)
  })
})
