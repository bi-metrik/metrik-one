/**
 * Lo que el navegador manda en `data` ya no escribe claves que no le tocan.
 *
 * El hueco (riesgo 11, tercera ronda): `actualizarBloqueData` reemplazaba `data` entero con lo
 * que llegaba y `marcarBloqueCompleto` lo mezclaba, sin mirar el tipo del bloque ni las
 * claves. Con eso se escribía `docs`, `drive_url` o `drive_file_id` en cualquier bloque que
 * el usuario pudiera editar, y código de servidor lee esas claves para descargar (SSRF en
 * `procesarDocumentoNegocio`) o para descargar y BORRAR en Drive con credenciales que el
 * usuario no tiene. De paso se podía reescribir `_ediciones`, la traza de la corrección.
 *
 * EL DOBLE APLICA LOS `.eq()` Y GUARDA LO ESCRITO: se mira la fila, no el mensaje.
 *
 * VISTO FALLAR (2026-09-16) contra `negocio-v2-actions.ts` de `origin/main`: caen 4 (el
 * `drive_file_id` y el `_ediciones` del autosave, `docs` en un bloque de documentos por las
 * dos acciones); los 2 CONTROL siguen verdes. Quitando el saneo de `actualizarBloqueData`
 * caen 3; el de `marcarBloqueCompleto`, 1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let escrituras: Array<{ tabla: string; op: 'insert' | 'update'; payload: Fila }> = []
let puedeEditar = true
let tarifaUpme = 0

const guardEditarBloque = vi.fn(async (_negocioBloqueId: string) =>
  puedeEditar ? { ok: true } : { ok: false, error: 'Tu rol o área no permite editar en esta fase del negocio' },
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
  guardVerNegocio: async () => ({ ok: true }),
  guardAvanzarStage: async () => ({ ok: true }),
}))

vi.mock('@/lib/negocios/casilla-compartida', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/negocios/casilla-compartida')>()),
  resolverDestinoCompartido: async (_s: unknown, id: string) => id,
}))

vi.mock('@/lib/correcciones/registrar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/correcciones/registrar')>()),
  contextoCorreccion: async () => null,
}))

vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async () => ({ error: null }),
}))

vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())

// El modelo de dinero del negocio: solo importa la tarifa pasante, que es lo que separa
// el criterio del bloque de cobros de comparar contra el honorario pelado.
vi.mock('@/lib/actions/conciliacion-actions', () => ({
  leerModeloDineroCompleto: async () => (tarifaUpme > 0 ? { tarifa_upme: tarifaUpme } : null),
  leerModeloDineroNegocio: async () => null,
  crearCobrosSoenaCore: async () => ({ error: null }),
}))

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let operacion: 'select' | 'update' | 'insert' = 'select'
  let payload: Fila = {}

  const ejecutar = (): Fila[] => {
    if (operacion === 'insert') {
      escrituras.push({ tabla, op: 'insert', payload })
      return [payload]
    }
    const filas = (tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)))
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, payload)
      escrituras.push({ tabla, op: 'update', payload })
      return filas
    }
    return filas.map(f => structuredClone(f))
  }

  const api = {
    select() {
      return api
    },
    update(p: Fila) {
      operacion = 'update'
      payload = p
      return api
    },
    insert(p: Fila) {
      operacion = 'insert'
      payload = p
      return api
    },
    eq(col: string, val: unknown) {
      filtros.push(f => f[col] === val)
      return api
    },
    in(col: string, vals: unknown[]) {
      filtros.push(f => vals.includes(f[col]))
      return api
    },
    order() {
      return api
    },
    limit() {
      return api
    },
    single() {
      return Promise.resolve({ data: ejecutar()[0] ?? null, error: null })
    },
    maybeSingle() {
      return Promise.resolve({ data: ejecutar()[0] ?? null, error: null })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve({ data: ejecutar(), error: null }).then(resolve, reject)
    },
  }
  return api
}

import { actualizarBloqueData, marcarBloqueCompleto } from './negocio-v2-actions'

const NEGOCIO = 'neg-1'
const WS = 'ws-1'

function bloque(id: string, tipo: string, configExtra: Fila = {}, data: Fila = {}): Fila {
  return {
    id,
    negocio_id: NEGOCIO,
    estado: 'pendiente',
    data,
    bloque_configs: {
      es_gate: false,
      slug: null,
      nombre: `Bloque ${id}`,
      config_extra: configExtra,
      bloque_definitions: { tipo, nombre: tipo },
    },
  }
}

const dataDe = (id: string) => (tablas.negocio_bloques.find(b => b.id === id) as Fila).data as Fila

const CONFIG_DATOS = {
  fields: [
    { slug: 'ciudad_venta', tipo: 'select' },
    { slug: 'requiere_cita', tipo: 'toggle' },
  ],
}

beforeEach(() => {
  puedeEditar = true
  tarifaUpme = 0
  escrituras = []
  guardEditarBloque.mockClear()
  tablas = {
    negocio_bloques: [],
    bloque_items: [],
    negocios: [{ id: NEGOCIO, workspace_id: WS, precio_aprobado: 850_000, precio_estimado: null }],
    cobros: [],
  }
})

describe('actualizarBloqueData — el autosave', () => {
  it('no reescribe el id de Drive que tiene la fila', async () => {
    tablas.negocio_bloques.push(bloque('nb-d', 'datos', CONFIG_DATOS, { ciudad_venta: 'Bogota', drive_file_id: 'drv-propio' }))
    const r = await actualizarBloqueData('nb-d', { ciudad_venta: 'Cali', drive_file_id: 'drv-de-otro-cliente' }, undefined, { revalidate: false })
    expect(r.error).toBeNull()
    expect(dataDe('nb-d')).toEqual({ ciudad_venta: 'Cali', drive_file_id: 'drv-propio' })
  })

  it('no reescribe la traza de la corrección', async () => {
    const traza = { ciudad_venta: { antes: 'Bogota', por_nombre: 'Operadora' } }
    tablas.negocio_bloques.push(bloque('nb-d', 'datos', CONFIG_DATOS, { ciudad_venta: 'Cali', _ediciones: traza }))
    await actualizarBloqueData('nb-d', { ciudad_venta: 'Cali', _ediciones: {} }, undefined, { revalidate: false })
    expect(dataDe('nb-d')._ediciones).toEqual(traza)
  })

  it('no escribe `docs` en un bloque de documentos', async () => {
    const docs = { factura: 'one://ve-documentos/ws-1/negocios/neg-1/nb-docs/factura.pdf' }
    tablas.negocio_bloques.push(bloque('nb-docs', 'documentos', {}, { docs }))
    await actualizarBloqueData('nb-docs', { docs: { factura: 'http://169.254.169.254/latest/meta-data/' } }, undefined, { revalidate: false })
    expect(dataDe('nb-docs').docs).toEqual(docs)
  })

  it('CONTROL — un campo que el navegador deja de mandar se borra, como antes', async () => {
    tablas.negocio_bloques.push(bloque('nb-d', 'datos', CONFIG_DATOS, { ciudad_venta: 'Bogota', requiere_cita: true }))
    await actualizarBloqueData('nb-d', { ciudad_venta: 'Cali' }, undefined, { revalidate: false })
    expect(dataDe('nb-d')).toEqual({ ciudad_venta: 'Cali' })
  })
})

describe('marcarBloqueCompleto — la mezcla', () => {
  const config = { documentos: [{ slug: 'rut', label: 'RUT', required: true }] }

  it('con los documentos completos cierra, pero `docs` no cambia', async () => {
    const docs = { rut: 'one://ve-documentos/ws-1/negocios/neg-1/nb-docs/rut.pdf' }
    tablas.negocio_bloques.push(bloque('nb-docs', 'documentos', config, { docs }))
    const r = await marcarBloqueCompleto('nb-docs', { docs: { rut: 'http://169.254.169.254/latest/meta-data/' } })
    expect(r.error).toBeNull()
    expect(dataDe('nb-docs').docs).toEqual(docs)
  })

  it('CONTROL — los campos de un bloque datos se siguen guardando', async () => {
    tablas.negocio_bloques.push(bloque('nb-d', 'datos', CONFIG_DATOS, {}))
    const r = await marcarBloqueCompleto('nb-d', { ciudad_venta: 'Cali', requiere_cita: false })
    expect(r.error).toBeNull()
    expect(dataDe('nb-d')).toMatchObject({ ciudad_venta: 'Cali', requiere_cita: false })
  })
})
