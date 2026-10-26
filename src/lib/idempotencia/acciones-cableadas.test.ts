/**
 * Una acción cableada de punta a punta: `addComment` con la clave de intención.
 * El mismo comentario enviado dos veces (seguidas y a la vez) deja UNA fila.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>
let tabla: Map<string, Fila>
let comentarios: Fila[]

const ceder = () => new Promise<void>((r) => setTimeout(r, 0))

function tablaClaves() {
  return {
    from: () => {
      const filtros: Array<[string, unknown]> = []
      let op: 'select' | 'update' | 'delete' = 'select'
      let payload: Fila = {}
      const coinciden = () => [...tabla.values()].filter((f) => filtros.every(([c, v]) => f[c] === v))
      const correr = async () => {
        await ceder()
        if (op === 'update') { coinciden().forEach((f) => Object.assign(f, payload)); return { data: [], error: null } }
        if (op === 'delete') { coinciden().forEach((f) => tabla.delete(f.clave as string)); return { data: null, error: null } }
        return { data: coinciden(), error: null }
      }
      const q: Record<string, unknown> = {
        insert: async (f: Fila) => {
          await ceder()
          if (tabla.has(f.clave as string)) return { error: { code: '23505', message: 'duplicate' } }
          tabla.set(f.clave as string, { ...f, creada_at: new Date().toISOString() })
          return { error: null }
        },
        select: () => q,
        update: (p: Fila) => { op = 'update'; payload = p; return q },
        delete: () => { op = 'delete'; return q },
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return q },
        maybeSingle: async () => ({ data: ((await correr()).data as Fila[])[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => correr().then(res, rej),
      }
      return q
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => tablaClaves() }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
    workspaceId: 'ws-1',
    userId: 'u-1',
    staffId: 's-1',
    role: 'operator',
    error: null,
  }),
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_s: unknown, fila: Fila) => {
    await ceder()
    comentarios.push(fila)
    return { ok: true, id: `log-${comentarios.length}` }
  },
}))

const { addComment } = await import('@/app/(app)/activity-actions')

const CLAVE = 'c0ffee00-1111-4222-8333-444455556666'

beforeEach(() => {
  tabla = new Map()
  comentarios = []
})

describe('addComment con clave de intención', () => {
  it('el mismo envío dos veces SEGUIDAS deja un comentario', async () => {
    const a = await addComment('negocio', 'n1', 'listo', null, null, undefined, CLAVE)
    const b = await addComment('negocio', 'n1', 'listo', null, null, undefined, CLAVE)
    expect(comentarios).toHaveLength(1)
    expect(b).toEqual(a)
  })

  it('el mismo envío dos veces A LA VEZ deja un comentario', async () => {
    await Promise.all([
      addComment('negocio', 'n1', 'listo', null, null, undefined, CLAVE),
      addComment('negocio', 'n1', 'listo', null, null, undefined, CLAVE),
    ])
    expect(comentarios).toHaveLength(1)
  })

  it('otra intención (otra clave) con el mismo texto sí es otro comentario', async () => {
    await addComment('negocio', 'n1', 'listo', null, null, undefined, CLAVE)
    await addComment('negocio', 'n1', 'listo', null, null, undefined, 'c0ffee00-1111-4222-8333-999999999999')
    expect(comentarios).toHaveLength(2)
  })

  it('sin clave (pestaña vieja) se comporta como antes', async () => {
    await addComment('negocio', 'n1', 'listo')
    await addComment('negocio', 'n1', 'listo')
    expect(comentarios).toHaveLength(2)
  })
})
