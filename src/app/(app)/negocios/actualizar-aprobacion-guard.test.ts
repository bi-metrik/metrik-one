/**
 * `actualizarAprobacion` decide quién aprueba, mira el tipo y deja de reemplazar el `data`.
 *
 * El hueco: la server action no tenía guard ni miraba el tipo, y el `data` que llegaba
 * reemplazaba al guardado. Con cualquier id y `estado: 'aprobado'` escribía `completo`
 * sobre cualquier bloque, y al decidir borraba el `aprobador_id` que se había designado.
 *
 * Lo que se fija aquí:
 * - sin permiso de edición no se escribe;
 * - un rol no gerencial, o un gerencial que no es el aprobador designado, no decide;
 * - el aprobador designado escribe SOLO los campos de la aprobación y conserva el resto;
 * - un bloque que no es de aprobación se rechaza;
 * - un estado fuera de los permitidos se rechaza;
 * - el aprobador se elige entre los profiles del workspace, y solo entre quien puede decidir:
 *   dueño o administrador del workspace, no desactivado en su equipo (la misma regla que la lista);
 * - quitar al aprobador sigue permitido;
 * - un designado desactivado en el equipo no decide;
 * - el registro en el timeline solo ocurre si se escribió.
 *
 * EL DOBLE APLICA LOS FILTROS `.eq()` y registra las escrituras.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let escrituras: Array<{ tabla: string; op: 'insert' | 'update'; payload: Fila }> = []
let puedeEditar = true
let sesion = { role: 'owner', userId: 'p-owner' }

const guardEditarBloque = vi.fn(async (_negocioBloqueId: string) =>
  puedeEditar ? { ok: true } : { ok: false, error: 'Tu rol o área no permite editar en esta fase del negocio' },
)
const registrarActividad = vi.fn(async (..._args: unknown[]) => ({ error: null }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: 'ws-1',
    userId: sesion.userId,
    role: sesion.role,
    staffId: 'staff-1',
    error: null,
  }),
}))

vi.mock('@/lib/permissions/guard-negocio', () => ({
  guardEditarBloque: (id: string) => guardEditarBloque(id),
  guardVerNegocio: async () => ({ ok: true }),
  guardAvanzarStage: async () => ({ ok: true }),
}))

vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: (...args: unknown[]) => registrarActividad(...args),
}))

vi.mock('@/lib/actions/conciliacion-actions', () => ({
  leerModeloDineroCompleto: async () => null,
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

import { actualizarAprobacion } from './negocio-v2-actions'
import {
  MENSAJE_NO_ES_APROBACION,
  MENSAJE_ESTADO_INVALIDO,
  MENSAJE_ROL_APROBACION,
  MENSAJE_NO_ES_EL_APROBADOR,
  MENSAJE_YA_DECIDIDA,
  MENSAJE_APROBADOR_AJENO,
  MENSAJE_APROBADOR_NO_PUEDE_DECIDIR,
  MENSAJE_DECISOR_INACTIVO,
  opcionesAprobador,
  perfilesConEstadoEnEquipo,
} from '@/lib/negocios/aprobacion-bloque'

const NEGOCIO = 'neg-1'

function bloque(id: string, tipo: string, data: Fila = {}, estado = 'pendiente'): Fila {
  return {
    id,
    negocio_id: NEGOCIO,
    estado,
    data,
    bloque_configs: { bloque_definitions: { tipo } },
  }
}

const filaDe = (id: string) => tablas.negocio_bloques.find(b => b.id === id) as Fila
const escribioEnBloques = () => escrituras.some(e => e.tabla === 'negocio_bloques')

beforeEach(() => {
  puedeEditar = true
  sesion = { role: 'owner', userId: 'p-owner' }
  escrituras = []
  guardEditarBloque.mockClear()
  registrarActividad.mockClear()
  tablas = {
    negocio_bloques: [],
    profiles: [
      { id: 'p-owner', workspace_id: 'ws-1', role: 'owner' },
      { id: 'p-admin', workspace_id: 'ws-1', role: 'admin' },
      { id: 'p-oper', workspace_id: 'ws-1', role: 'operator' },
      { id: 'p-admin-baja', workspace_id: 'ws-1', role: 'admin' },
      { id: 'p-ajeno', workspace_id: 'ws-otro', role: 'admin' },
    ],
    staff: [
      { profile_id: 'p-owner', workspace_id: 'ws-1', is_active: true },
      { profile_id: 'p-admin-baja', workspace_id: 'ws-1', is_active: false },
      // Un staff desactivado en OTRO workspace no saca a nadie de este.
      { profile_id: 'p-admin', workspace_id: 'ws-otro', is_active: false },
    ],
  }
})

describe('quién aprueba', () => {
  it('sin permiso de edición no se escribe ni se anota, aunque sea el aprobador designado', async () => {
    puedeEditar = false
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { aprobador_id: 'p-owner', estado: 'pendiente' }))

    const r = await actualizarAprobacion('nb-apr', { estado: 'aprobado' })

    expect(r.error).toBe('Tu rol o área no permite editar en esta fase del negocio')
    expect(escribioEnBloques()).toBe(false)
    expect(filaDe('nb-apr').estado).toBe('pendiente')
    expect(registrarActividad).not.toHaveBeenCalled()
  })

  it('un supervisor con permiso de edición no aprueba: la aprobación es gerencial', async () => {
    sesion = { role: 'supervisor', userId: 'p-owner' }
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { aprobador_id: 'p-owner' }))

    const r = await actualizarAprobacion('nb-apr', { estado: 'aprobado' })

    expect(r.error).toBe(MENSAJE_ROL_APROBACION)
    expect(escribioEnBloques()).toBe(false)
    expect(registrarActividad).not.toHaveBeenCalled()
  })

  it('un gerencial que no es el aprobador designado no decide', async () => {
    sesion = { role: 'admin', userId: 'p-admin' }
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { aprobador_id: 'p-owner' }))

    const r = await actualizarAprobacion('nb-apr', { estado: 'aprobado' })

    expect(r.error).toBe(MENSAJE_NO_ES_EL_APROBADOR)
    expect(escribioEnBloques()).toBe(false)
    expect(filaDe('nb-apr').estado).toBe('pendiente')
  })

  it('el aprobador designado aprueba: escribe solo los campos de la aprobación y conserva el resto', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', {
      aprobador_id: 'p-owner', estado: 'pendiente', referencia: 'contrato-7',
    }))

    const r = await actualizarAprobacion('nb-apr', {
      estado: 'aprobado',
      comentario: 'listo',
      // Lo que mande el navegador sobre quién y cuándo no cuenta.
      aprobador_id: 'p-admin',
      aprobado_at: '1999-01-01T00:00:00.000Z',
    } as Parameters<typeof actualizarAprobacion>[1])

    expect(r.error).toBeNull()
    const fila = filaDe('nb-apr')
    const data = fila.data as Fila
    expect(fila.estado).toBe('completo')
    expect(fila.completado_por).toBe('p-owner')
    expect(data.referencia).toBe('contrato-7')
    expect(data.aprobador_id).toBe('p-owner')
    expect(data.estado).toBe('aprobado')
    expect(data.comentario).toBe('listo')
    expect(data.decidido_por).toBe('p-owner')
    expect(data.aprobado_at).not.toBe('1999-01-01T00:00:00.000Z')
    expect(registrarActividad).toHaveBeenCalledTimes(1)
  })

  it('rechazar deja el bloque pendiente y conserva lo guardado', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { aprobador_id: 'p-owner', referencia: 'x' }))

    const r = await actualizarAprobacion('nb-apr', { estado: 'rechazado', comentario: 'no' })

    expect(r.error).toBeNull()
    const fila = filaDe('nb-apr')
    expect(fila.estado).toBe('pendiente')
    expect(fila.data).toMatchObject({ estado: 'rechazado', referencia: 'x', aprobador_id: 'p-owner', decidido_por: 'p-owner' })
  })

  it('una aprobación ya decidida no se vuelve a decidir', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { aprobador_id: 'p-owner', estado: 'rechazado' }))

    const r = await actualizarAprobacion('nb-apr', { estado: 'aprobado' })

    expect(r.error).toBe(MENSAJE_YA_DECIDIDA)
    expect(escribioEnBloques()).toBe(false)
  })
})

describe('designar al aprobador', () => {
  it('un gerencial designa a un profile del workspace sin borrar lo demás', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { referencia: 'x' }))

    const r = await actualizarAprobacion('nb-apr', { aprobador_id: 'p-admin', estado: 'pendiente' })

    expect(r.error).toBeNull()
    expect(filaDe('nb-apr').estado).toBe('pendiente')
    expect(filaDe('nb-apr').data).toEqual({ referencia: 'x', aprobador_id: 'p-admin', estado: 'pendiente' })
  })

  it('un no gerencial no se designa: rechaza, no escribe y no anota', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { referencia: 'x' }))

    const r = await actualizarAprobacion('nb-apr', { aprobador_id: 'p-oper', estado: 'pendiente' })

    expect(r.error).toBe(MENSAJE_APROBADOR_NO_PUEDE_DECIDIR)
    expect(escribioEnBloques()).toBe(false)
    expect(filaDe('nb-apr').data).toEqual({ referencia: 'x' })
    expect(registrarActividad).not.toHaveBeenCalled()
  })

  it('un administrador desactivado en el equipo no se designa', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion'))

    const r = await actualizarAprobacion('nb-apr', { aprobador_id: 'p-admin-baja', estado: 'pendiente' })

    expect(r.error).toBe(MENSAJE_APROBADOR_NO_PUEDE_DECIDIR)
    expect(escribioEnBloques()).toBe(false)
  })

  it('designar a un gerencial escribe y anota en el timeline', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion'))

    const r = await actualizarAprobacion('nb-apr', { aprobador_id: 'p-owner', estado: 'pendiente' })

    expect(r.error).toBeNull()
    expect(filaDe('nb-apr').data).toEqual({ aprobador_id: 'p-owner', estado: 'pendiente' })
    expect(registrarActividad).toHaveBeenCalledTimes(1)
  })

  it('quitar al aprobador sigue funcionando, aunque el designado ya no pueda decidir', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { aprobador_id: 'p-oper', referencia: 'x' }))

    const r = await actualizarAprobacion('nb-apr', { aprobador_id: '', estado: 'pendiente' })

    expect(r.error).toBeNull()
    expect(filaDe('nb-apr').data).toEqual({ referencia: 'x', estado: 'pendiente' })
  })

  it('la lista del selector y el servidor aceptan exactamente a las mismas personas', async () => {
    // La lista se arma con la misma función que usa getNegocioDetalleCompleto: los profiles del
    // workspace y la fila de staff de ESE workspace (las dos consultas filtran por workspace).
    const perfilesDelWorkspace = perfilesConEstadoEnEquipo(
      tablas.profiles
        .filter(p => p.workspace_id === 'ws-1')
        .map(p => ({ id: p.id as string, full_name: null, role: p.role as string })),
      tablas.staff.filter(s => s.workspace_id === 'ws-1') as Array<{ profile_id: string | null; is_active: boolean | null }>,
    )
    const enLista = new Set(opcionesAprobador(perfilesDelWorkspace, null).elegibles.map(p => p.id))
    expect(enLista).toEqual(new Set(['p-owner', 'p-admin']))

    for (const p of perfilesDelWorkspace) {
      tablas.negocio_bloques = [bloque('nb-apr', 'aprobacion')]
      escrituras = []
      const r = await actualizarAprobacion('nb-apr', { aprobador_id: p.id, estado: 'pendiente' })
      expect({ id: p.id, acepta: r.error === null }).toEqual({ id: p.id, acepta: enLista.has(p.id) })
    }
  })

  it('un aprobador de otro workspace, o inventado, no se designa', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion'))

    for (const id of ['p-ajeno', 'no-existe']) {
      const r = await actualizarAprobacion('nb-apr', { aprobador_id: id, estado: 'pendiente' })
      expect(r.error).toBe(MENSAJE_APROBADOR_AJENO)
    }
    expect(escribioEnBloques()).toBe(false)
  })
})

describe('decidir exige seguir activo en el equipo', () => {
  it('el designado desactivado en el equipo no decide, aunque la designación sea vieja', async () => {
    sesion = { role: 'admin', userId: 'p-admin-baja' }
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { aprobador_id: 'p-admin-baja' }))

    const r = await actualizarAprobacion('nb-apr', { estado: 'aprobado' })

    expect(r.error).toBe(MENSAJE_DECISOR_INACTIVO)
    expect(escribioEnBloques()).toBe(false)
    expect(filaDe('nb-apr').estado).toBe('pendiente')
    expect(registrarActividad).not.toHaveBeenCalled()
  })

  it('sin fila de staff en este workspace sigue decidiendo: no hay desactivación registrada', async () => {
    sesion = { role: 'admin', userId: 'p-admin' }
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { aprobador_id: 'p-admin' }))

    const r = await actualizarAprobacion('nb-apr', { estado: 'rechazado', comentario: 'no' })

    expect(r.error).toBeNull()
    expect(filaDe('nb-apr').data).toMatchObject({ estado: 'rechazado', decidido_por: 'p-admin' })
  })
})

describe('tipo y estado', () => {
  it('un bloque que no es de aprobación se rechaza sin escribir', async () => {
    tablas.negocio_bloques.push(bloque('nb-crono', 'cronograma', { items: 3 }))

    const r = await actualizarAprobacion('nb-crono', { estado: 'aprobado' })

    expect(r.error).toBe(MENSAJE_NO_ES_APROBACION)
    expect(filaDe('nb-crono').estado).toBe('pendiente')
    expect(filaDe('nb-crono').data).toEqual({ items: 3 })
    expect(escribioEnBloques()).toBe(false)
    expect(registrarActividad).not.toHaveBeenCalled()
  })

  it('un estado fuera de los permitidos se rechaza antes de tocar nada', async () => {
    tablas.negocio_bloques.push(bloque('nb-apr', 'aprobacion', { aprobador_id: 'p-owner' }))

    const r = await actualizarAprobacion('nb-apr', { estado: 'completo' } as unknown as Parameters<typeof actualizarAprobacion>[1])

    expect(r.error).toBe(MENSAJE_ESTADO_INVALIDO)
    expect(escribioEnBloques()).toBe(false)
    expect(guardEditarBloque).not.toHaveBeenCalled()
  })
})
