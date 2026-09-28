/**
 * Borrar una entrada de la Actividad: solo comentarios, y solo el autor o un
 * owner/admin del workspace.
 *
 * Hasta el 2026-09-28 `deleteActivity` borraba cualquier comentario del workspace:
 * bastaba con conocer el id. El doble de Supabase APLICA los filtros y BORRA de
 * verdad, para que "no se borró" sea una afirmación sobre la tabla y no sobre el
 * mensaje que devuelve la acción.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { puedeBorrarEntrada } from '@/lib/activity/borrar-comentario'

type Fila = Record<string, unknown>

const WS = 'ws-1'
const AUTORA = 'staff-autora'
const OTRA = 'staff-otra'

let rol: string | null = 'operator'
let staffId: string | null = AUTORA
let tabla: Fila[] = []

function doble() {
  return {
    from: (nombre: string) => {
      if (nombre !== 'activity_log') throw new Error(`tabla inesperada: ${nombre}`)
      const filtros: Array<(f: Fila) => boolean> = []
      let op: 'select' | 'delete' = 'select'
      const coinciden = () => tabla.filter(f => filtros.every(p => p(f)))
      const q = {
        select: () => q,
        delete: () => { op = 'delete'; return q },
        eq: (col: string, val: unknown) => { filtros.push(f => f[col] === val); return q },
        maybeSingle: async () => ({ data: coinciden()[0] ?? null, error: null }),
        then: (resolve: (r: unknown) => void) => {
          if (op === 'delete') {
            const borrar = new Set(coinciden())
            tabla = tabla.filter(f => !borrar.has(f))
            resolve({ data: [...borrar].map(f => ({ id: f.id })), error: null })
          } else {
            resolve({ data: coinciden(), error: null })
          }
        },
      }
      return q
    },
  }
}

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: doble(), workspaceId: WS, role: rol, staffId, error: null }),
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ ok: true, id: 'x' }) }))

const { deleteActivity } = await import('./activity-actions')

const existe = (id: string) => tabla.some(f => f.id === id)

beforeEach(() => {
  rol = 'operator'
  staffId = AUTORA
  tabla = [
    { id: 'c-propio', workspace_id: WS, tipo: 'comentario', autor_id: AUTORA },
    { id: 'c-ajeno', workspace_id: WS, tipo: 'comentario', autor_id: OTRA },
    { id: 'c-sin-autor', workspace_id: WS, tipo: 'comentario', autor_id: null },
    { id: 'etapa', workspace_id: WS, tipo: 'cambio_etapa', autor_id: AUTORA },
    { id: 'sistema', workspace_id: WS, tipo: 'sistema', autor_id: null },
    { id: 'c-otro-ws', workspace_id: 'ws-2', tipo: 'comentario', autor_id: AUTORA },
  ]
})

describe('deleteActivity', () => {
  it('la autora borra su comentario', async () => {
    const res = await deleteActivity('c-propio')
    expect(res).toEqual({ success: true })
    expect(existe('c-propio')).toBe(false)
  })

  it('un operador NO borra el comentario de otra persona', async () => {
    const res = await deleteActivity('c-ajeno')
    expect(res.error).toMatch(/quien escribió/)
    expect(existe('c-ajeno')).toBe(true)
  })

  it('un supervisor tampoco borra comentarios ajenos (moderar es de owner/admin)', async () => {
    rol = 'supervisor'
    await deleteActivity('c-ajeno')
    expect(existe('c-ajeno')).toBe(true)
  })

  it.each(['owner', 'admin'])('un %s borra el comentario de otra persona', async r => {
    rol = r
    staffId = 'staff-jefe'
    const res = await deleteActivity('c-ajeno')
    expect(res).toEqual({ success: true })
    expect(existe('c-ajeno')).toBe(false)
  })

  it('nadie borra un cambio de etapa, ni siquiera su autora ni el owner', async () => {
    expect((await deleteActivity('etapa')).error).toMatch(/Solo se pueden borrar comentarios/)
    rol = 'owner'
    expect((await deleteActivity('etapa')).error).toMatch(/Solo se pueden borrar comentarios/)
    expect(existe('etapa')).toBe(true)
  })

  it('nadie borra un evento del sistema', async () => {
    rol = 'admin'
    await deleteActivity('sistema')
    expect(existe('sistema')).toBe(true)
  })

  it('un comentario sin autor no le pertenece a un usuario sin staff', async () => {
    staffId = null
    await deleteActivity('c-sin-autor')
    expect(existe('c-sin-autor')).toBe(true)
  })

  it('no alcanza entradas de otro workspace', async () => {
    rol = 'owner'
    const res = await deleteActivity('c-otro-ws')
    expect(res.error).toBeTruthy()
    expect(existe('c-otro-ws')).toBe(true)
  })
})

describe('puedeBorrarEntrada (la regla que también decide el botón)', () => {
  it('coincide con lo que permite el servidor', () => {
    const q = (role: string | null, staff: string | null) => ({ role, staffId: staff })
    expect(puedeBorrarEntrada({ tipo: 'comentario', autor_id: AUTORA }, q('operator', AUTORA))).toBe(true)
    expect(puedeBorrarEntrada({ tipo: 'comentario', autor_id: OTRA }, q('operator', AUTORA))).toBe(false)
    expect(puedeBorrarEntrada({ tipo: 'comentario', autor_id: OTRA }, q('read_only', AUTORA))).toBe(false)
    expect(puedeBorrarEntrada({ tipo: 'comentario', autor_id: OTRA }, q('admin', null))).toBe(true)
    expect(puedeBorrarEntrada({ tipo: 'comentario', autor_id: null }, q('operator', null))).toBe(false)
    expect(puedeBorrarEntrada({ tipo: 'cambio_etapa', autor_id: AUTORA }, q('owner', AUTORA))).toBe(false)
  })
})
