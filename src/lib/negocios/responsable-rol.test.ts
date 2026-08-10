import { describe, it, expect } from 'vitest'
import { rolDesdeAreas, asignarResponsable } from './responsable-rol'

describe('rolDesdeAreas', () => {
  it('deriva comercial y operaciones', () => {
    expect(rolDesdeAreas(['comercial'])).toBe('comercial')
    expect(rolDesdeAreas(['operaciones'])).toBe('operaciones')
  })

  it('con las dos áreas gana comercial (la venta nace primero)', () => {
    expect(rolDesdeAreas(['operaciones', 'comercial'])).toBe('comercial')
  })

  it('financiera o sin áreas queda sin rol: no recibe avisos de etapa', () => {
    expect(rolDesdeAreas(['financiera'])).toBeNull()
    expect(rolDesdeAreas(['direccion'])).toBeNull()
    expect(rolDesdeAreas([])).toBeNull()
  })
})

// ── Doble de supabase ────────────────────────────────────────────────────────
// Registra las operaciones para poder afirmar sobre lo ESCRITO, no sobre lo que
// devuelve el helper: el defecto que este módulo corrige era justamente una fila
// escrita sin `rol`.
type Op = { tabla: string; accion: string; payload?: unknown; filtros: Record<string, unknown> }

function fakeDb(opts: { areas: string[]; ocupanteActual?: string | null }) {
  const ops: Op[] = []
  const client = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {}
      const q: Record<string, unknown> = {}
      const chain = {
        select() {
          q.accion = 'select'
          return chain
        },
        delete() {
          ops.push({ tabla, accion: 'delete', filtros })
          return chain
        },
        upsert(payload: unknown) {
          ops.push({ tabla, accion: 'upsert', payload, filtros })
          return Promise.resolve({ error: null })
        },
        eq(col: string, val: unknown) {
          filtros[col] = val
          return chain
        },
        maybeSingle() {
          if (tabla === 'negocio_responsables') {
            return Promise.resolve({
              data: opts.ocupanteActual ? { staff_id: opts.ocupanteActual } : null,
            })
          }
          return Promise.resolve({ data: null })
        },
        then(resolve: (v: unknown) => unknown) {
          // `select` sobre staff_areas se await-ea directo, sin maybeSingle
          return Promise.resolve({
            data: tabla === 'staff_areas' ? opts.areas.map((area) => ({ area })) : [],
          }).then(resolve)
        },
      }
      return chain
    },
  }
  return { client, ops }
}

describe('asignarResponsable', () => {
  it('escribe la fila CON rol derivado del área', async () => {
    const { client, ops } = fakeDb({ areas: ['comercial'] })
    const res = await asignarResponsable(client, {
      negocioId: 'n1',
      staffId: 's1',
      assignedBy: 'p1',
    })

    expect(res.rol).toBe('comercial')
    const upsert = ops.find((o) => o.accion === 'upsert')
    expect(upsert?.payload).toMatchObject({ negocio_id: 'n1', staff_id: 's1', rol: 'comercial' })
  })

  it('libera el puesto y reporta a quién desplazó', async () => {
    const { client, ops } = fakeDb({ areas: ['operaciones'], ocupanteActual: 's-previo' })
    const res = await asignarResponsable(client, {
      negocioId: 'n1',
      staffId: 's-nuevo',
      assignedBy: 'p1',
    })

    expect(res.rol).toBe('operaciones')
    expect(res.desplazado).toBe('s-previo')
    const del = ops.find((o) => o.accion === 'delete')
    expect(del?.filtros).toMatchObject({ negocio_id: 'n1', rol: 'operaciones' })
  })

  it('reasignar a la misma persona no la desplaza a sí misma', async () => {
    const { client } = fakeDb({ areas: ['comercial'], ocupanteActual: 's1' })
    const res = await asignarResponsable(client, {
      negocioId: 'n1',
      staffId: 's1',
      assignedBy: 'p1',
    })
    expect(res.desplazado).toBeNull()
  })

  it('sin área comercial ni operaciones asigna igual, con rol null y sin liberar puesto', async () => {
    const { client, ops } = fakeDb({ areas: ['financiera'] })
    const res = await asignarResponsable(client, {
      negocioId: 'n1',
      staffId: 's-fin',
      assignedBy: 'p1',
    })

    expect(res.rol).toBeNull()
    expect(ops.find((o) => o.accion === 'delete')).toBeUndefined()
    expect(ops.find((o) => o.accion === 'upsert')?.payload).toMatchObject({ rol: null })
  })
})
