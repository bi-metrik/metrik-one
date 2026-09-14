/**
 * `inicializarBloqueItems` y `reevaluarBloqueCronograma`: el guard que corresponde a
 * cada una, antes de escribir. Hermana de `bloque-items-guard.test.ts` (#676).
 *
 * Las dos no se protegen igual, a propósito:
 *
 * - `reevaluarBloqueCronograma` solo la llama BloqueCronograma después de agregar,
 *   editar o borrar una actividad, que son gestos de edición. Lleva
 *   `guardEditarBloque`, igual que esas tres.
 * - `inicializarBloqueItems` la llaman BloqueChecklist y BloqueCronograma AL MONTAR,
 *   para cualquiera que abra el negocio (solo lectura, otra área, historial). Es
 *   materializar la plantilla de la config, no editar. Lleva `guardVerNegocio`, y
 *   quien la llama NO decide qué se escribe: la plantilla se lee de la config en el
 *   servidor. Si se le pusiera `guardEditarBloque`, el primero sin permiso de edición
 *   que abriera el negocio vería el checklist vacío y un error.
 *
 * EL DOBLE APLICA LOS FILTROS `.eq()`, así que un bloque de otro negocio o de otra
 * config no puede colarse en el resultado.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let escrituras: Array<{ tabla: string; op: 'insert' | 'update' | 'delete'; payload?: unknown }> = []
let puedeEditar = true
let puedeVer = true

const guardEditarBloque = vi.fn(async (_negocioBloqueId: string) =>
  puedeEditar ? { ok: true } : { ok: false, error: 'Tu rol o área no permite editar en esta fase del negocio' },
)
const guardVerNegocio = vi.fn(async (_negocioId: string) =>
  puedeVer ? { ok: true } : { ok: false, error: 'Sin acceso a este negocio' },
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
  guardVerNegocio: (id: string) => guardVerNegocio(id),
  guardAvanzarStage: async () => ({ ok: true }),
}))

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Fila | Fila[] = {}
  let limite: number | null = null

  const aplica = (f: Fila) => filtros.every(([col, val]) => f[col] === val)

  const ejecutar = (): { data: unknown; error: null } => {
    if (operacion === 'insert') {
      const nuevas = (Array.isArray(payload) ? payload : [payload]).map((p, i) => ({
        id: `item-nuevo-${(tablas[tabla] ?? []).length + i + 1}`,
        completado_por: null,
        completado_at: null,
        link_url: null,
        ...p,
      }))
      tablas[tabla] = [...(tablas[tabla] ?? []), ...nuevas]
      escrituras.push({ tabla, op: 'insert', payload })
      return { data: nuevas, error: null }
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
    const vistas = filas.map(f => ({ ...f }))
    return { data: limite === null ? vistas : vistas.slice(0, limite), error: null }
  }

  const api = {
    select() {
      // Tras un insert, `.select(...)` solo proyecta: la operación sigue siendo insert.
      return api
    },
    insert(p: Fila | Fila[]) {
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
    order() {
      return api
    },
    limit(n: number) {
      limite = n
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

import { inicializarBloqueItems, reevaluarBloqueCronograma } from './negocio-v2-actions'

const NEGOCIO = 'neg-1'
const CHECKLIST = 'nb-checklist-vacio'
const CRONOGRAMA = 'nb-cronograma'

const PLANTILLA = [
  { label: 'Pasaportes vigentes', tipo: 'checkbox' },
  { label: 'Seguro de viaje', tipo: 'texto' },
]

function bloque(id: string, tipo: string, items: unknown, estado = 'pendiente'): Fila {
  return {
    id,
    negocio_id: NEGOCIO,
    estado,
    bloque_configs: { config_extra: { items }, bloque_definitions: { tipo } },
  }
}

const itemsDe = (negocioBloqueId: string) =>
  (tablas.bloque_items ?? []).filter(i => i.negocio_bloque_id === negocioBloqueId)

beforeEach(() => {
  puedeEditar = true
  puedeVer = true
  escrituras = []
  guardEditarBloque.mockClear()
  guardVerNegocio.mockClear()
  tablas = {
    negocio_bloques: [
      bloque(CHECKLIST, 'checklist', PLANTILLA),
      bloque(CRONOGRAMA, 'cronograma', []),
      bloque('nb-datos', 'datos', PLANTILLA),
      bloque('nb-con-items', 'checklist', PLANTILLA),
      { ...bloque('nb-otro-negocio', 'checklist', PLANTILLA), negocio_id: 'neg-otro' },
    ],
    bloque_items: [
      { id: 'it-existente', negocio_bloque_id: 'nb-con-items', label: 'Ya estaba', tipo: 'texto', orden: 0, completado: false },
      { id: 'it-crono-1', negocio_bloque_id: CRONOGRAMA, label: 'Instalación', orden: 0, fecha_inicio: '2026-09-20', fecha_fin: null },
    ],
  }
})

describe('inicializarBloqueItems', () => {
  it('quien no puede ver el negocio: no siembra y devuelve el error del guard', async () => {
    puedeVer = false
    const r = await inicializarBloqueItems(CHECKLIST)
    expect(r).toEqual({ items: [], error: 'Sin acceso a este negocio' })
    expect(guardVerNegocio).toHaveBeenCalledWith(NEGOCIO)
    expect(escrituras).toEqual([])
    expect(itemsDe(CHECKLIST)).toHaveLength(0)
  })

  it('quien ve el negocio SIN permiso de edición siembra la plantilla (lo que pasa al abrirlo)', async () => {
    puedeEditar = false
    const r = await inicializarBloqueItems(CHECKLIST)
    expect(r.error).toBeNull()
    expect(r.items.map(i => i.label)).toEqual(['Pasaportes vigentes', 'Seguro de viaje'])
    expect(guardEditarBloque).not.toHaveBeenCalled()
    expect(guardVerNegocio).toHaveBeenCalledWith(NEGOCIO)
    expect(itemsDe(CHECKLIST).map(i => [i.label, i.tipo, i.orden])).toEqual([
      ['Pasaportes vigentes', 'checkbox', 0],
      ['Seguro de viaje', 'texto', 1],
    ])
  })

  it('lo que escribe sale de la config, no de lo que mande el navegador', async () => {
    // Firma vieja: el cliente mandaba la plantilla. Un llamador malicioso aún puede
    // mandar un segundo argumento; tiene que ignorarse.
    const llamar = inicializarBloqueItems as unknown as (id: string, t: unknown) => ReturnType<typeof inicializarBloqueItems>
    await llamar(CHECKLIST, [{ label: 'Texto inyectado', tipo: 'checkbox' }])
    expect(itemsDe(CHECKLIST).map(i => i.label)).toEqual(['Pasaportes vigentes', 'Seguro de viaje'])
  })

  it('bloque que ya tiene items: los devuelve y no siembra', async () => {
    const r = await inicializarBloqueItems('nb-con-items')
    expect(r.error).toBeNull()
    expect(r.items.map(i => i.label)).toEqual(['Ya estaba'])
    expect(escrituras).toEqual([])
  })

  it('tipo que no usa plantilla de items: no siembra aunque la config traiga `items`', async () => {
    const r = await inicializarBloqueItems('nb-datos')
    expect(r).toEqual({ items: [], error: null })
    expect(escrituras).toEqual([])
  })

  it('bloque inexistente: "Bloque no encontrado", sin guard ni escritura', async () => {
    const r = await inicializarBloqueItems('no-existe')
    expect(r).toEqual({ items: [], error: 'Bloque no encontrado' })
    expect(guardVerNegocio).not.toHaveBeenCalled()
    expect(escrituras).toEqual([])
  })

  it('el guard mira el negocio DEL BLOQUE', async () => {
    await inicializarBloqueItems('nb-otro-negocio')
    expect(guardVerNegocio).toHaveBeenCalledWith('neg-otro')
  })
})

describe('reevaluarBloqueCronograma', () => {
  it('guard rechaza: no toca el estado del bloque y devuelve el error del guard', async () => {
    puedeEditar = false
    const r = await reevaluarBloqueCronograma(CRONOGRAMA)
    expect(r).toEqual({ error: 'Tu rol o área no permite editar en esta fase del negocio' })
    expect(guardEditarBloque).toHaveBeenCalledWith(CRONOGRAMA)
    expect(escrituras).toEqual([])
    expect(tablas.negocio_bloques.find(b => b.id === CRONOGRAMA)?.estado).toBe('pendiente')
  })

  it('guard sin mensaje: cae a "Sin permiso"', async () => {
    guardEditarBloque.mockImplementationOnce(async () => ({ ok: false }) as { ok: boolean; error: string })
    const r = await reevaluarBloqueCronograma(CRONOGRAMA)
    expect(r).toEqual({ error: 'Sin permiso' })
    expect(escrituras).toEqual([])
  })

  it('guard acepta: recalcula y marca completo el bloque', async () => {
    const r = await reevaluarBloqueCronograma(CRONOGRAMA)
    expect(r).toEqual({ error: null })
    expect(guardEditarBloque).toHaveBeenCalledWith(CRONOGRAMA)
    expect(tablas.negocio_bloques.find(b => b.id === CRONOGRAMA)?.estado).toBe('completo')
  })

  it('guard acepta con todas las fechas exigidas por la config: una sin fin deja el bloque pendiente', async () => {
    const b = tablas.negocio_bloques.find(x => x.id === CRONOGRAMA)!
    b.estado = 'completo'
    ;(b.bloque_configs as { config_extra: Record<string, unknown> }).config_extra.require_all_dates = true
    const r = await reevaluarBloqueCronograma(CRONOGRAMA)
    expect(r).toEqual({ error: null })
    expect(b.estado).toBe('pendiente')
  })
})
