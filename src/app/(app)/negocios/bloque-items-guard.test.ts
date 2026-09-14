/**
 * `agregarBloqueItem`, `actualizarBloqueItem` y `eliminarBloqueItem` — el guard de
 * edición del bloque va ANTES de cualquier escritura en `bloque_items`.
 *
 * El hueco: las tres escribían con solo la RLS por workspace, así que cualquier
 * usuario del workspace podía agregar, renombrar, mover fechas o borrar pasos del
 * cronograma de una etapa que su rol/área no edita. `marcarBloqueItem` ya lo cerraba.
 *
 * Corre contra las server actions reales. El guard se dobla (su lógica tiene sus
 * propias pruebas en `can-edit`): lo que se cuida acá es el CABLEADO — que se llame,
 * con el `negocio_bloque_id` correcto y no con el id del item, y que un rechazo corte
 * antes de tocar la tabla.
 *
 * EL DOBLE APLICA LOS FILTROS `.eq()`: si el código resolviera el bloque de otro item,
 * el guard recibiría otro id y la prueba lo delata.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let escrituras: Array<{ tabla: string; op: 'insert' | 'update' | 'delete'; payload?: unknown }> = []
let permitido = true

const guardEditarBloque = vi.fn(async (_negocioBloqueId: string) =>
  permitido ? { ok: true } : { ok: false, error: 'Tu rol o área no permite editar en esta fase del negocio' },
)

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: 'ws-1',
    userId: 'user-1',
    staffId: 'staff-1',
    error: null,
  }),
}))

vi.mock('@/lib/permissions/guard-negocio', () => ({
  guardEditarBloque: (id: string) => guardEditarBloque(id),
  guardAvanzarStage: async () => ({ ok: true }),
  guardVerNegocio: async () => ({ ok: true }),
}))

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Fila = {}

  const aplica = (f: Fila) => filtros.every(([col, val]) => f[col] === val)

  const ejecutar = (): { data: unknown; error: null } => {
    if (operacion === 'insert') {
      const fila = { id: `item-nuevo-${(tablas[tabla] ?? []).length + 1}`, ...payload }
      tablas[tabla] = [...(tablas[tabla] ?? []), fila]
      escrituras.push({ tabla, op: 'insert', payload })
      return { data: [fila], error: null }
    }
    const filas = (tablas[tabla] ?? []).filter(aplica)
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, payload)
      escrituras.push({ tabla, op: 'update', payload })
      return { data: filas, error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = (tablas[tabla] ?? []).filter(f => !aplica(f))
      escrituras.push({ tabla, op: 'delete' })
      return { data: null, error: null }
    }
    return { data: filas.map(f => ({ ...f })), error: null }
  }

  const api = {
    select() {
      // Tras un insert, `.select('id')` solo proyecta: la operación sigue siendo insert.
      return api
    },
    insert(p: Fila) {
      operacion = 'insert'
      payload = p
      return api
    },
    update(p: Fila) {
      operacion = 'update'
      payload = p
      return api
    },
    delete() {
      operacion = 'delete'
      return api
    },
    eq(col: string, val: unknown) {
      filtros.push([col, val])
      return api
    },
    single() {
      const { data } = ejecutar()
      return Promise.resolve({ data: (data as Fila[] | null)?.[0] ?? null, error: null })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(ejecutar()).then(resolve, reject)
    },
  }
  return api
}

import { agregarBloqueItem, actualizarBloqueItem, eliminarBloqueItem } from './negocio-v2-actions'

const BLOQUE = 'nb-cronograma-operaciones'
const ITEM = 'item-1'

const item = (id: string) => (tablas.bloque_items ?? []).find(i => i.id === id)

beforeEach(() => {
  permitido = true
  escrituras = []
  guardEditarBloque.mockClear()
  tablas = {
    bloque_items: [
      { id: ITEM, negocio_bloque_id: BLOQUE, label: 'Instalación', orden: 0, fecha_inicio: null, fecha_fin: null },
      // Item de OTRO bloque: si el código resolviera mal, el guard recibiría este id.
      { id: 'item-otro', negocio_bloque_id: 'nb-otro', label: 'Otro', orden: 0 },
    ],
  }
})

describe('agregarBloqueItem', () => {
  it('guard rechaza: no inserta y devuelve el error del guard', async () => {
    permitido = false
    const r = await agregarBloqueItem(BLOQUE, 'Paso nuevo', 'texto', 1)
    expect(r).toEqual({ id: null, error: 'Tu rol o área no permite editar en esta fase del negocio' })
    expect(guardEditarBloque).toHaveBeenCalledWith(BLOQUE)
    expect(escrituras).toEqual([])
    expect(tablas.bloque_items).toHaveLength(2)
  })

  it('guard sin mensaje: cae a "Sin permiso"', async () => {
    guardEditarBloque.mockImplementationOnce(async () => ({ ok: false }) as { ok: boolean; error: string })
    const r = await agregarBloqueItem(BLOQUE, 'Paso nuevo', 'texto', 1)
    expect(r).toEqual({ id: null, error: 'Sin permiso' })
    expect(escrituras).toEqual([])
  })

  it('guard acepta: inserta en el bloque y devuelve el id', async () => {
    const r = await agregarBloqueItem(BLOQUE, 'Paso nuevo', 'texto', 1, { fecha_inicio: '2026-09-20' })
    expect(r.error).toBeNull()
    expect(r.id).toBeTruthy()
    expect(guardEditarBloque).toHaveBeenCalledWith(BLOQUE)
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0]).toMatchObject({
      tabla: 'bloque_items',
      op: 'insert',
      payload: { negocio_bloque_id: BLOQUE, label: 'Paso nuevo', orden: 1, fecha_inicio: '2026-09-20' },
    })
  })
})

describe('actualizarBloqueItem', () => {
  it('guard rechaza: no actualiza, y el guard recibe el bloque del item (no el id del item)', async () => {
    permitido = false
    const r = await actualizarBloqueItem(ITEM, { label: 'Renombrado', fecha_fin: '2026-10-01' })
    expect(r).toEqual({ error: 'Tu rol o área no permite editar en esta fase del negocio' })
    expect(guardEditarBloque).toHaveBeenCalledTimes(1)
    expect(guardEditarBloque).toHaveBeenCalledWith(BLOQUE)
    expect(escrituras).toEqual([])
    expect(item(ITEM)).toMatchObject({ label: 'Instalación', fecha_fin: null })
  })

  it('guard acepta: actualiza solo ese item', async () => {
    const r = await actualizarBloqueItem(ITEM, { label: 'Renombrado', fecha_fin: '2026-10-01' })
    expect(r).toEqual({ error: null })
    expect(guardEditarBloque).toHaveBeenCalledWith(BLOQUE)
    expect(item(ITEM)).toMatchObject({ label: 'Renombrado', fecha_fin: '2026-10-01' })
    expect(item('item-otro')).toMatchObject({ label: 'Otro' })
  })

  it('item inexistente: "Item no encontrado", sin guard ni escritura', async () => {
    const r = await actualizarBloqueItem('no-existe', { label: 'x' })
    expect(r).toEqual({ error: 'Item no encontrado' })
    expect(guardEditarBloque).not.toHaveBeenCalled()
    expect(escrituras).toEqual([])
  })
})

describe('eliminarBloqueItem', () => {
  it('guard rechaza: no borra, y el guard recibe el bloque del item', async () => {
    permitido = false
    const r = await eliminarBloqueItem(ITEM)
    expect(r).toEqual({ error: 'Tu rol o área no permite editar en esta fase del negocio' })
    expect(guardEditarBloque).toHaveBeenCalledTimes(1)
    expect(guardEditarBloque).toHaveBeenCalledWith(BLOQUE)
    expect(escrituras).toEqual([])
    expect(item(ITEM)).toBeDefined()
  })

  it('guard acepta: borra solo ese item', async () => {
    const r = await eliminarBloqueItem(ITEM)
    expect(r).toEqual({ error: null })
    expect(guardEditarBloque).toHaveBeenCalledWith(BLOQUE)
    expect(item(ITEM)).toBeUndefined()
    expect(item('item-otro')).toBeDefined()
  })

  it('item inexistente: "Item no encontrado", sin guard ni escritura', async () => {
    const r = await eliminarBloqueItem('no-existe')
    expect(r).toEqual({ error: 'Item no encontrado' })
    expect(guardEditarBloque).not.toHaveBeenCalled()
    expect(escrituras).toEqual([])
  })
})
