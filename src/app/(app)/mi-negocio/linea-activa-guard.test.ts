/**
 * `updateLineaActiva(lineaId)` pide las mismas condiciones con las que `/mi-negocio` muestra
 * "Mi flujo".
 *
 * El hueco (riesgo 11, tercera ronda): cualquier sesión del workspace cambiaba la línea
 * activa, y a CUALQUIER línea: una plantilla, una propia o la de otro cliente. La línea activa
 * decide el flujo por el que entra todo negocio nuevo.
 *
 * EL DOBLE APLICA LOS `.eq()` Y REGISTRA LOS UPDATES: se mira que no se escriba.
 *
 * VISTO FALLAR (2026-09-16) contra `mi-negocio/actions.ts` de `origin/main`: caen los 4
 * rechazos; los 2 CONTROL siguen verdes. Quitando cada guarda cae su caso: rol 1, tipo de
 * workspace 1, línea ajena 1, línea inexistente 1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

const WS = 'ws-nativo'
let rol = 'owner'
let tablas: Record<string, Fila[]> = {}
const updates: Array<{ tabla: string; payload: Fila }> = []

function cliente() {
  return {
    from: (tabla: string) => {
      const eqs: Fila = {}
      let payload: Fila | null = null
      const filas = () => (tablas[tabla] ?? []).filter((f) => Object.entries(eqs).every(([c, v]) => f[c] === v))
      const q = {
        select: () => q,
        update: (p: Fila) => {
          payload = p
          return q
        },
        eq: (c: string, v: unknown) => {
          eqs[c] = v
          return q
        },
        maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          if (payload) updates.push({ tabla, payload })
          return Promise.resolve({ data: filas(), error: null }).then(ok)
        },
      }
      return q
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: cliente(), workspaceId: WS, role: rol, error: null }),
}))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())

import { updateLineaActiva } from './actions'
import { reiniciarModulo } from '../../../../test/exigir-modulo-doble'

beforeEach(() => {
  rol = 'owner'
  updates.length = 0
  reiniciarModulo(WS, { business: true })
  tablas = {
    workspaces: [
      { id: WS, tipo: 'nativo' },
      { id: 'ws-clarity', tipo: 'clarity' },
    ],
    lineas_negocio: [
      { id: 'plantilla-servicios', workspace_id: null },
      { id: 'linea-propia', workspace_id: WS },
      { id: 'linea-de-otro-cliente', workspace_id: 'ws-soena' },
    ],
  }
})

describe('updateLineaActiva', () => {
  it('un operador no cambia el flujo', async () => {
    rol = 'operator'
    const r = await updateLineaActiva('plantilla-servicios')
    expect(r.success).toBe(false)
    expect(updates).toEqual([])
  })

  it('la línea de otro cliente no se activa', async () => {
    const r = await updateLineaActiva('linea-de-otro-cliente')
    expect(r).toEqual({ success: false, error: 'Línea no encontrada' })
    expect(updates).toEqual([])
  })

  it('una línea que no existe tampoco', async () => {
    const r = await updateLineaActiva('linea-inventada')
    expect(r.success).toBe(false)
    expect(updates).toEqual([])
  })

  it('en un workspace Clarity el flujo no se cambia desde aquí', async () => {
    tablas.workspaces = [{ id: WS, tipo: 'clarity' }]
    const r = await updateLineaActiva('linea-propia')
    expect(r.success).toBe(false)
    expect(updates).toEqual([])
  })

  it('CONTROL — el dueño activa una plantilla', async () => {
    const r = await updateLineaActiva('plantilla-servicios')
    expect(r).toEqual({ success: true })
    expect(updates).toEqual([{ tabla: 'workspaces', payload: { linea_activa_id: 'plantilla-servicios' } }])
  })

  it('CONTROL — un admin activa una línea propia', async () => {
    rol = 'admin'
    const r = await updateLineaActiva('linea-propia')
    expect(r).toEqual({ success: true })
  })
})
