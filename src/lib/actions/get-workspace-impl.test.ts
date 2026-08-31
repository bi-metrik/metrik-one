/**
 * Resolucion del staff en getWorkspace — el caso que NO puede volver:
 *
 * `staff_profile_id_key` es UNIQUE (profile_id) GLOBAL (no por workspace) y la
 * policy `staff_ws` acota toda lectura autenticada al workspace actual. Un
 * profile cuyo staff vive en OTRO workspace (platform_admin que cambio de
 * workspace) era invisible para las dos lecturas del codigo pero chocaba igual
 * en el insert: 23505 en cada request, con `staffId = null` de resultado.
 *
 * El doble es consciente de tabla Y de RLS: el cliente autenticado solo ve
 * filas de `staff` del workspace del profile; el service client las ve todas.
 * Sin esa distincion, el caso central (staff en otro workspace) seria
 * indistinguible de "no hay staff" y estos tests pasarian por la razon
 * equivocada.
 *
 * VISTOS FALLAR (2026-08-31) contra el codigo de main: 4 de 6. "staff en OTRO
 * workspace" caia por las tres afirmaciones (main insertaba → 23505 →
 * console.error y sin aviso), "el aviso sale UNA vez" caia porque main no
 * avisaba nunca, "staff INACTIVO en el workspace actual" caia por la
 * afirmacion de cero escrituras (main resolvia el caso chocando el insert), y
 * "carrera" caia por el conteo de escrituras.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}))

vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: usuario }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => clienteFalso({ rls: true }),
  createServiceClient: () => clienteFalso({ rls: false }),
}))

import { __getWorkspaceImplParaPruebas as getWorkspaceImpl } from './get-workspace-impl'

// ─── Estado de la "base" ───────────────────────────────────────────────────

type StaffRow = { id: string; profile_id: string; workspace_id: string; is_active: boolean }

let usuario: { id: string }
let perfil: { workspace_id: string; role: string; full_name: string; platform_admin: boolean }
let staffRows: StaffRow[]
/** Escrituras sobre `staff` hechas con el cliente AUTENTICADO (insert o upsert). */
let escriturasStaff: number
/**
 * Simula la carrera insert-vs-select: tras la lectura del service client que
 * devuelve vacio, otro request "gana" y crea el registro antes del upsert.
 */
let simularCarreraTrasLectura: boolean

function clienteFalso(opts: { rls: boolean }) {
  return {
    from(tabla: string) {
      const filtros: Array<[string, unknown]> = []
      const visibles = (): StaffRow[] => {
        if (tabla !== 'staff') return []
        let r = staffRows.filter((row) =>
          filtros.every(([c, v]) => (row as unknown as Record<string, unknown>)[c] === v),
        )
        // RLS `staff_ws`: el autenticado solo ve su workspace actual.
        if (opts.rls) r = r.filter((row) => row.workspace_id === perfil.workspace_id)
        return r
      }
      const escribir = (row: Record<string, unknown>, viaUpsert: boolean) => {
        if (opts.rls) escriturasStaff++
        const conflicto = staffRows.some((r) => r.profile_id === row.profile_id)
        const resolver = () => {
          if (conflicto) {
            return viaUpsert
              ? { data: null, error: null } // ON CONFLICT DO NOTHING
              : {
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "staff_profile_id_key"',
                  },
                }
          }
          const nueva: StaffRow = {
            id: 'staff-nuevo',
            profile_id: row.profile_id as string,
            workspace_id: row.workspace_id as string,
            is_active: row.is_active as boolean,
          }
          staffRows.push(nueva)
          return { data: { id: nueva.id }, error: null }
        }
        const sub = {
          select: () => sub,
          single: async () => resolver(),
          maybeSingle: async () => resolver(),
        }
        return sub
      }
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: (c: string, v: unknown) => {
          filtros.push([c, v])
          return chain
        },
        // `resolverAreas` hace `await ...eq(...)` directo sobre staff_areas.
        then: (res: (v: unknown) => void) => res({ data: [], error: null }),
        maybeSingle: async () => {
          const fila = visibles()[0] ?? null
          if (!opts.rls && tabla === 'staff' && !fila && simularCarreraTrasLectura) {
            simularCarreraTrasLectura = false
            staffRows.push({
              id: 'staff-competidor',
              profile_id: usuario.id,
              workspace_id: perfil.workspace_id,
              is_active: true,
            })
          }
          return { data: fila, error: null }
        },
        single: async () => {
          if (tabla === 'profiles') return { data: perfil, error: null }
          const fila = visibles()[0] ?? null
          return { data: fila, error: fila ? null : { code: 'PGRST116' } }
        },
        insert: (row: Record<string, unknown>) => escribir(row, false),
        upsert: (row: Record<string, unknown>) => escribir(row, true),
      }
      return chain
    },
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  perfil = { workspace_id: 'ws-actual', role: 'owner', full_name: 'Prueba', platform_admin: false }
  staffRows = []
  escriturasStaff = 0
  simularCarreraTrasLectura = false
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
})

describe('getWorkspace — resolucion del staff', () => {
  it('staff activo en el workspace actual: lo resuelve la primera lectura, sin escrituras', async () => {
    usuario = { id: 'user-activo' }
    staffRows.push({ id: 's1', profile_id: 'user-activo', workspace_id: 'ws-actual', is_active: true })

    const r = await getWorkspaceImpl()

    expect(r.staffId).toBe('s1')
    expect(escriturasStaff).toBe(0)
  })

  it('staff INACTIVO en el workspace actual: se usa (criterio PR #180) y ya no choca el insert', async () => {
    usuario = { id: 'user-inactivo' }
    staffRows.push({ id: 's2', profile_id: 'user-inactivo', workspace_id: 'ws-actual', is_active: false })

    const r = await getWorkspaceImpl()

    expect(r.staffId).toBe('s2')
    expect(escriturasStaff).toBe(0)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('staff en OTRO workspace (platform_admin con switch): staffId null, sin insert y sin error', async () => {
    usuario = { id: 'user-ajeno' }
    staffRows.push({ id: 's3', profile_id: 'user-ajeno', workspace_id: 'ws-otro', is_active: true })

    const r = await getWorkspaceImpl()

    // No se devuelve el staff del otro tenant (FK de activity_log/responsables)
    // ni se intenta crear uno (el unique global lo rechaza con 23505).
    expect(r.staffId).toBeNull()
    expect(escriturasStaff).toBe(0)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('el aviso de staff ajeno sale UNA sola vez aunque el caso se repita en cada request', async () => {
    usuario = { id: 'user-avisado' }
    staffRows.push({ id: 's4', profile_id: 'user-avisado', workspace_id: 'ws-otro', is_active: true })

    await getWorkspaceImpl()
    await getWorkspaceImpl()

    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('sin staff en ninguna parte: se crea y se devuelve', async () => {
    usuario = { id: 'user-nuevo' }

    const r = await getWorkspaceImpl()

    expect(r.staffId).toBe('staff-nuevo')
    expect(escriturasStaff).toBe(1)
    expect(staffRows).toHaveLength(1)
    expect(staffRows[0].workspace_id).toBe('ws-actual')
  })

  it('carrera insert-vs-select: el que pierde relee y usa el registro del ganador, sin error', async () => {
    usuario = { id: 'user-carrera' }
    simularCarreraTrasLectura = true

    const r = await getWorkspaceImpl()

    expect(r.staffId).toBe('staff-competidor')
    expect(errorSpy).not.toHaveBeenCalled()
    // No se duplico el registro.
    expect(staffRows).toHaveLength(1)
  })
})
