/**
 * Crear una cotización desde el negocio (`createCotizacionDetalladaNegocio`): la fila nace con
 * los términos copiados de la línea solo en Trappvel, y en los demás workspaces el insert
 * es el de siempre (ni siquiera lleva la clave).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TERMINOS_BASE_TRAPPVEL } from '@/lib/cotizaciones/__fixtures__/terminos-base-trappvel'

const estado = {
  slug: 'trappvel' as string | null,
  configExtra: null as unknown,
  inserts: [] as Record<string, unknown>[],
  /** Las cotizaciones del negocio creadas en la ventana del doble clic. */
  recientes: [] as Record<string, unknown>[],
}

function fakeSupabase() {
  return {
    rpc: async () => ({ data: 'COT-2026-0100', error: null }),
    from(tabla: string) {
      let valores: Record<string, unknown> | null = null
      const b = {
        select() { return b },
        eq() { return b },
        gte() { return Promise.resolve({ data: estado.recientes, error: null }) },
        insert(v: Record<string, unknown>) { valores = v; return b },
        async single() {
          if (valores) estado.inserts.push(valores)
          return { data: { id: 'cot-nueva' }, error: null }
        },
        async maybeSingle() {
          if (tabla === 'workspaces') return { data: { cotizacion_template_slug: estado.slug }, error: null }
          if (tabla === 'negocios') return { data: { lineas_negocio: { config_extra: estado.configExtra } }, error: null }
          return { data: null, error: null }
        },
      }
      return b
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => fakeSupabase() }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: fakeSupabase(), workspaceId: 'ws-1', staffId: 'staff-1', role: 'owner', error: null }),
}))

const { createCotizacionDetalladaNegocio } = await import('./[id]/cotizacion/actions')

beforeEach(() => {
  estado.slug = 'trappvel'
  estado.configExtra = null
  estado.inserts = []
  estado.recientes = []
})

describe('createCotizacionDetalladaNegocio: términos al nacer', () => {
  it('Trappvel con texto base: la cotización nace con la copia guardada', async () => {
    estado.configExtra = { terminos_base: TERMINOS_BASE_TRAPPVEL, margen: { convencion: 'sobre_venta', default_pct: 12 } }
    const res = await createCotizacionDetalladaNegocio('neg-1')
    expect(res).toEqual({ success: true, id: 'cot-nueva' })
    expect(estado.inserts).toHaveLength(1)
    expect(estado.inserts[0]).toMatchObject({
      negocio_id: 'neg-1',
      estado: 'borrador',
      terminos_condiciones: TERMINOS_BASE_TRAPPVEL,
      convencion_margen: 'sobre_venta',
      margen_default_pct: 12,
    })
  })

  it('Trappvel sin texto base: nace sin términos, como hoy', async () => {
    estado.configExtra = { margen: { convencion: 'sobre_venta' } }
    await createCotizacionDetalladaNegocio('neg-1')
    expect(estado.inserts[0]).not.toHaveProperty('terminos_condiciones')
  })

  it('⚠️ otro workspace con texto base en su línea: el insert no cambia (R6)', async () => {
    estado.slug = null
    estado.configExtra = { terminos_base: 'Condiciones.' }
    await createCotizacionDetalladaNegocio('neg-1')
    expect(estado.inserts[0]).not.toHaveProperty('terminos_condiciones')
  })
})

describe('createCotizacionDetalladaNegocio: un doble clic no crea dos borradores (QA del 2026-10-29)', () => {
  it('con un borrador vacío creado hace un segundo, lo devuelve y no inserta otro', async () => {
    estado.recientes = [{ id: 'cot-de-hace-un-segundo', estado: 'borrador', created_at: new Date(Date.now() - 1000).toISOString(), valor_total: 0 }]
    const res = await createCotizacionDetalladaNegocio('neg-1')
    expect(res).toEqual({ success: true, id: 'cot-de-hace-un-segundo' })
    expect(estado.inserts).toHaveLength(0)
  })

  it('un borrador que ya tiene valor, o uno enviado, no se reusa: crea la nueva', async () => {
    const hace = new Date(Date.now() - 1000).toISOString()
    estado.recientes = [
      { id: 'con-valor', estado: 'borrador', created_at: hace, valor_total: 5_000_000 },
      { id: 'enviada', estado: 'enviada', created_at: hace, valor_total: 0 },
    ]
    const res = await createCotizacionDetalladaNegocio('neg-1')
    expect(res).toEqual({ success: true, id: 'cot-nueva' })
    expect(estado.inserts).toHaveLength(1)
  })
})
