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

function fakeDb(opts: {
  areas: string[]
  ocupanteActual?: string | null
  /** staff.id → full_name. Lo usan el texto del evento y el nombre del desplazado. */
  nombres?: Record<string, string>
  /** profiles.id del asignador → staff.id en ESE workspace. Ausente = no resuelve. */
  staffPorProfile?: Record<string, string>
  /** El negocio no existe o no se pudo leer su workspace. */
  sinWorkspace?: boolean
  /** La escritura de la fila falla: no debe anunciarse nada. */
  upsertFalla?: boolean
}) {
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
          return Promise.resolve({
            error: opts.upsertFalla ? { message: 'no se pudo escribir la fila' } : null,
          })
        },
        insert(payload: unknown) {
          ops.push({ tabla, accion: 'insert', payload, filtros })
          return chain
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
          if (tabla === 'negocios') {
            return Promise.resolve({
              data: opts.sinWorkspace ? null : { workspace_id: 'ws1' },
              error: null,
            })
          }
          if (tabla === 'staff') {
            // Dos lecturas distintas sobre la misma tabla: por `id` sale el nombre,
            // por `profile_id` sale el staff del autor dentro del workspace.
            if (filtros.profile_id) {
              const id = opts.staffPorProfile?.[filtros.profile_id as string]
              return Promise.resolve({ data: id ? { id } : null, error: null })
            }
            const nombre = opts.nombres?.[filtros.id as string]
            return Promise.resolve({ data: nombre ? { full_name: nombre } : null, error: null })
          }
          if (tabla === 'activity_log') {
            return Promise.resolve({ data: { id: 'evt-1' }, error: null })
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

/** El evento que quedó en el timeline, si quedó alguno. */
function eventoLog(ops: Op[]) {
  return ops.find((o) => o.tabla === 'activity_log' && o.accion === 'insert')?.payload as
    | { tipo: string; contenido: string; autor_id: string | null; workspace_id: string }
    | undefined
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

// ── El evento en el timeline ─────────────────────────────────────────────────
// Vive en el helper, no en la pantalla, porque los cinco caminos de asignación
// entran por aquí. Estas pruebas son las que fallan si alguien lo devuelve arriba.

describe('asignarResponsable · registro en activity_log', () => {
  it('anota la asignación con el rol y el autor traducido de profiles a staff', async () => {
    const { client, ops } = fakeDb({
      areas: ['comercial'],
      nombres: { s1: 'Jessica Tejada' },
      staffPorProfile: { p1: 'staff-deisy' },
    })
    await asignarResponsable(client, { negocioId: 'n1', staffId: 's1', assignedBy: 'p1' })

    expect(eventoLog(ops)).toMatchObject({
      workspace_id: 'ws1',
      tipo: 'cambio_sistema',
      autor_id: 'staff-deisy',
      contenido: 'Responsable agregado: Jessica Tejada como comercial',
    })
  })

  it('dice a quién reemplazó, que es lo que un cambio silencioso esconde', async () => {
    const { client, ops } = fakeDb({
      areas: ['operaciones'],
      ocupanteActual: 's-previo',
      nombres: { 's-nuevo': 'María Camila Garzón', 's-previo': 'Deisy Ramirez' },
      staffPorProfile: { p1: 'staff-deisy' },
    })
    await asignarResponsable(client, { negocioId: 'n1', staffId: 's-nuevo', assignedBy: 'p1' })

    expect(eventoLog(ops)?.contenido).toBe(
      'Responsable agregado: María Camila Garzón como operaciones, en reemplazo de Deisy Ramirez',
    )
  })

  it('sin rol lo DICE, en vez de callar que no recibirá avisos', async () => {
    const { client, ops } = fakeDb({ areas: ['financiera'], nombres: { 's-fin': 'Leidy Llanos' } })
    await asignarResponsable(client, { negocioId: 'n1', staffId: 's-fin', assignedBy: null })

    expect(eventoLog(ops)?.contenido).toBe(
      'Responsable agregado: Leidy Llanos (sin área: no recibe avisos de etapa)',
    )
  })

  it('si el asignador no tiene staff en ESE workspace, el autor va nulo pero el evento se escribe', async () => {
    // El UNIQUE (profile_id) de staff es global: sin acotar por workspace, un
    // platform_admin quedaría como autor con su staff de otro tenant.
    const { client, ops } = fakeDb({
      areas: ['comercial'],
      nombres: { s1: 'Jessica Tejada' },
      staffPorProfile: {},
    })
    await asignarResponsable(client, { negocioId: 'n1', staffId: 's1', assignedBy: 'p-ajeno' })

    const evento = eventoLog(ops)
    expect(evento?.autor_id).toBeNull()
    expect(evento?.contenido).toContain('Jessica Tejada')
  })

  it('si la fila NO se pudo escribir, no anuncia una asignación que no ocurrió', async () => {
    const { client, ops } = fakeDb({ areas: ['comercial'], upsertFalla: true })
    const res = await asignarResponsable(client, {
      negocioId: 'n1',
      staffId: 's1',
      assignedBy: 'p1',
    })

    expect(res.error).toBe('no se pudo escribir la fila')
    expect(eventoLog(ops)).toBeUndefined()
  })
})
