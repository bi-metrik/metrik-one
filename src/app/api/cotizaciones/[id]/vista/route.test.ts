/**
 * La ruta que el editor del viaje usa para ponerse al día sin recargar (`vista-fresca.ts`).
 *
 * Se fija: la forma que espera el editor, que es SOLO LECTURA (el doble revienta ante
 * cualquier escritura), que no se cachea, que sin sesión no devuelve nada y que una
 * cotización que el RLS no deja ver es un 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let sesion = true
let cotizaciones: Record<string, unknown>[] = []
let lecturasDeItems = 0

function clienteFalso() {
  return {
    from(tabla: string) {
      if (tabla !== 'cotizaciones') throw new Error(`lectura inesperada de ${tabla}`)
      let id: unknown = null
      const api = {
        select: () => api,
        eq: (_c: string, v: unknown) => { id = v; return api },
        maybeSingle: async () => ({ data: cotizaciones.find(c => c.id === id) ?? null, error: null }),
        update: () => { throw new Error('la ruta no escribe') },
        insert: () => { throw new Error('la ruta no escribe') },
        delete: () => { throw new Error('la ruta no escribe') },
        upsert: () => { throw new Error('la ruta no escribe') },
      }
      return api
    },
  }
}

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => sesion
    ? { supabase: clienteFalso(), workspaceId: 'ws-trappvel', error: null }
    : { supabase: clienteFalso(), workspaceId: null, error: 'No autenticado' },
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({
  getCotizacionItems: async (id: string) => {
    lecturasDeItems += 1
    return id === 'cot-19' ? [{ id: 'item-lord', subtotal: 800_000, rubros: [{ id: 'r1', valor_unitario: 400_000 }] }] : []
  },
}))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({
  getAdicionalesDeCotizacion: async () => ({ disponible: true, porItem: { 'item-lord': [{ id: 'a1' }] } }),
}))

const { GET } = await import('./route')

const llamar = (id: string) => GET(new Request(`https://x/api/cotizaciones/${id}/vista`), { params: Promise.resolve({ id }) })

beforeEach(() => {
  sesion = true
  lecturasDeItems = 0
  cotizaciones = [{ id: 'cot-19', valor_total: 941_176 }]
})

describe('GET /api/cotizaciones/[id]/vista', () => {
  it('devuelve lo guardado con la forma que lee el editor, y no se cachea', async () => {
    const antes = new Date().toISOString()
    const r = await llamar('cot-19')
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const cuerpo = await r.json()
    expect(cuerpo.ok).toBe(true)
    expect(cuerpo.items[0].rubros[0].valor_unitario).toBe(400_000)
    expect(cuerpo.adicionalesPorItem).toEqual({ 'item-lord': [{ id: 'a1' }] })
    expect(cuerpo.valorTotal).toBe(941_176)
    expect(cuerpo.leidaEn >= antes).toBe(true)
  })

  it('sin sesión: 401 y no lee nada', async () => {
    sesion = false
    const r = await llamar('cot-19')
    expect(r.status).toBe(401)
    expect((await r.json()).ok).toBe(false)
    expect(lecturasDeItems).toBe(0)
  })

  it('una cotización que el RLS no deja ver: 404 y no lee sus líneas', async () => {
    const r = await llamar('cot-de-otro-workspace')
    expect(r.status).toBe(404)
    expect(lecturasDeItems).toBe(0)
  })
})
