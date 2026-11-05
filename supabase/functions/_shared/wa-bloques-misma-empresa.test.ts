import { describe, expect, it, vi } from 'vitest'

// Tres módulos del grafo importan supabase-js por URL (esm.sh), que Node no carga. Ninguno se usa aquí.
// El grafo también lee `Deno.env` al cargar.
vi.hoisted(() => { (globalThis as Record<string, unknown>).Deno ??= { env: { get: () => undefined, toObject: () => ({}) } } })
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => ({}) }))
import type { SupabaseClient } from '@supabase/supabase-js'
import { bloquesDatosDelNegocio } from './wa-entendimiento'

/** `bloquesDatosDelNegocio` comprueba la empresa del negocio antes de leer sus bloques (guarda de misma empresa). */

const WS_A = 'ws-a'
const WS_B = 'ws-b'
const NEGOCIOS = [{ id: 'neg-b', workspace_id: WS_B }]
const BLOQUES = [{
  id: 'blq-1', negocio_id: 'neg-b', data: { destino: 'Cartagena' }, updated_at: null,
  bloque_configs: { orden: 1, config_extra: { fields: [{ slug: 'destino', label: 'Destino' }] }, bloque_definitions: { tipo: 'datos' }, etapas_negocio: { orden: 1 } },
}]

function falso() {
  const leidas: string[] = []
  const cliente = {
    from(tabla: string) {
      leidas.push(tabla)
      const filtros: Record<string, unknown> = {}
      const filas = () => (tabla === 'negocios' ? NEGOCIOS : BLOQUES).filter((f) =>
        Object.entries(filtros).every(([k, v]) => (f as Record<string, unknown>)[k] === v))
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filtros[k] = v; return q },
        maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
        then: (ok: (r: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: filas(), error: null }).then(ok),
      }
      return q
    },
  }
  return { cliente: cliente as unknown as SupabaseClient, leidas }
}

describe('bloquesDatosDelNegocio con la empresa', () => {
  it('un negocio de otra empresa devuelve el error y no lee bloques', async () => {
    const { cliente, leidas } = falso()
    const r = await bloquesDatosDelNegocio(cliente, WS_A, 'neg-b')
    expect(typeof r).toBe('string')
    expect(r).toMatch(/^no se pudieron leer los bloques del negocio/)
    expect(leidas).toEqual(['negocios'])
  })

  it('el negocio de la empresa devuelve sus bloques', async () => {
    const { cliente, leidas } = falso()
    const r = await bloquesDatosDelNegocio(cliente, WS_B, 'neg-b')
    expect(Array.isArray(r) && r.map((b) => b.id)).toEqual(['blq-1'])
    expect(leidas).toEqual(['negocios', 'negocio_bloques'])
  })
})
