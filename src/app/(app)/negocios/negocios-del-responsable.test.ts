import { describe, expect, it, vi } from 'vitest'

/**
 * Trappvel, 2026-10-16: el viaje que abre el bot con «¿Quién lleva este viaje?» le tiene que aparecer a esa persona en
 * sus negocios. No se construyó nada para eso: el operador ya ve solo los negocios donde es responsable
 * (`negocio_responsables`), y el bot escribe esa fila con la misma función que la app (`asignarResponsable`). Esta prueba
 * lo deja fijado: con la fila del responsable, el negocio sale en `getNegociosV2` de esa persona y no en la de otra.
 * Base de juguete: solo las tablas que esta lectura toca.
 */

const STAFF = { edgar: 'st-edgar', ale: 'st-ale' }
const TABLAS: Record<string, Array<Record<string, unknown>>> = {
  negocio_responsables: [{ negocio_id: 'n-bot', staff_id: STAFF.edgar, rol: 'comercial' }],
  negocios: [
    { id: 'n-bot', codigo: 'M1 26 4', nombre: 'SAN ANDRÉS', estado: 'abierto', pausado: false, workspace_id: 'ws', created_at: '2026-10-16T15:00:00Z', metadata: {}, negocio_responsables: [{ assigned_at: '2026-10-16T15:00:00Z', staff: { id: STAFF.edgar, full_name: 'Edgar Alba' } }] },
    { id: 'n-otro', codigo: 'D1 26 2', nombre: 'CARTAGENA', estado: 'abierto', pausado: false, workspace_id: 'ws', created_at: '2026-10-15T15:00:00Z', metadata: {}, negocio_responsables: [] },
  ],
}

let quien: string | null = STAFF.edgar
let rol = 'operator'
function cliente() {
  return {
    from(tabla: string) {
      let filas = [...(TABLAS[tabla] ?? [])]
      const q: Record<string, unknown> = {}
      const chain = new Proxy(q, {
        get(_t, k: string) {
          if (k === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(res)
          if (k === 'maybeSingle' || k === 'single') return () => Promise.resolve({ data: filas[0] ?? null, error: null })
          if (k === 'eq') return (col: string, val: unknown) => { filas = filas.filter((f) => !(col in f) || f[col] === val); return chain }
          if (k === 'in') return (col: string, vals: unknown[]) => { filas = filas.filter((f) => !(col in f) || vals.includes(f[col])); return chain }
          return () => chain
        },
      })
      return chain
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  }
}

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: cliente(), workspaceId: 'ws', userId: 'p-x', role: rol, staffId: quien, error: null }),
}))

describe('el viaje asignado le aparece a su responsable', () => {
  it('Edgar (operador) ve el viaje que lleva; Alejandra no', async () => {
    const { getNegociosV2 } = await import('./negocio-v2-actions')
    quien = STAFF.edgar
    expect((await getNegociosV2('abierto', false, false)).map((n) => n.id)).toEqual(['n-bot'])
    quien = STAFF.ale
    expect(await getNegociosV2('abierto', false, false)).toEqual([])
    // Importar las acciones de negocios tarda ~5 s en frío.
  }, 60_000)

  it('un operador SIN fila en staff no ve ninguno (antes veía todos)', async () => {
    const { getNegociosV2 } = await import('./negocio-v2-actions')
    rol = 'operator'
    quien = null
    expect(await getNegociosV2('abierto', false, false)).toEqual([])
    expect(await getNegociosV2('todos', false, false)).toEqual([])
  }, 60_000)

  it('el dueño sin staff sigue viendo todos (el default seguro es solo del operador)', async () => {
    const { getNegociosV2 } = await import('./negocio-v2-actions')
    rol = 'owner'
    quien = null
    expect((await getNegociosV2('abierto', false, false)).map((n) => n.id).sort()).toEqual(['n-bot', 'n-otro'])
    rol = 'operator'
  }, 60_000)
})
