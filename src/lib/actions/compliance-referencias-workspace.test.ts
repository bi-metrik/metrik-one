/**
 * Las fichas de cumplimiento solo se amarran a referencias del workspace de la sesion.
 *
 * El hueco (riesgo 11, segunda ronda, menor): `crearSujeto`, `actualizarSujeto`,
 * `crearDocumento` y `actualizarDocumento` escriben con el cliente de servicio y tomaban
 * del navegador `staff_id`, `segmento_id`, `responsable_profile_id` y
 * `responsable_cargo_id`. Las llaves foraneas solo exigen que el id exista en alguna
 * parte, asi que una ficha se podia amarrar al personal, al segmento, al usuario o al
 * cargo de otro cliente.
 *
 * Lo que se fija aqui: una referencia propia se escribe; una ajena no escribe nada.
 *
 * EL DOBLE APLICA LOS `.eq()` Y REGISTRA INSERTS Y UPDATES.
 *
 * VISTO FALLAR (2026-09-16): con `compliance-sujetos.ts` y `compliance-documentos.ts` de
 * `origin/main` caen los 7 casos de referencia ajena; los 3 caminos sanos siguen verdes.
 * Mutando sobre los archivos nuevos: sin la comprobacion de sujetos al crear caen 3, sin
 * la de sujetos al actualizar caen 2, con el helper de sujetos sin filtrar por workspace
 * caen 5, y sin cada una de las dos de cargo cae 1.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Fila = Record<string, unknown>

const TABLAS: Record<string, Fila[]> = {
  staff: [
    { id: 'staff-propio', workspace_id: 'ws-1' },
    { id: 'staff-ajeno', workspace_id: 'ws-2' },
  ],
  compliance_segmentos: [
    { id: 'seg-propio', workspace_id: 'ws-1' },
    { id: 'seg-ajeno', workspace_id: 'ws-2' },
  ],
  profiles: [
    { id: 'user-1', workspace_id: 'ws-1' },
    { id: 'user-ajeno', workspace_id: 'ws-2' },
  ],
  compliance_cargos: [
    { id: 'cargo-propio', workspace_id: 'ws-1' },
    { id: 'cargo-ajeno', workspace_id: 'ws-2' },
  ],
  compliance_sujetos: [],
  compliance_documentos: [],
}

const escrituras: Array<{ tabla: string; op: 'insert' | 'update'; payload: Fila }> = []

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-1', role: 'owner', error: null }),
}))
vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: { id: 'user-1' } }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => constructor(tabla),
    rpc: async () => ({ data: null, error: null }),
  }),
}))

function constructor(tabla: string) {
  const eqs: Fila = {}
  let op: 'insert' | 'update' | null = null
  let payload: Fila = {}
  const filtradas = () => (TABLAS[tabla] ?? []).filter((f) => Object.entries(eqs).every(([c, v]) => f[c] === v))
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      eqs[c] = v
      return q
    },
    insert: (p: Fila) => {
      op = 'insert'
      payload = p
      escrituras.push({ tabla, op, payload })
      return q
    },
    update: (p: Fila) => {
      op = 'update'
      payload = p
      escrituras.push({ tabla, op, payload })
      return q
    },
    maybeSingle: async () => ({ data: filtradas()[0] ?? null, error: null }),
    single: async () => (op === 'insert' ? { data: { id: 'nuevo' }, error: null } : { data: filtradas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(op ? { error: null } : { data: filtradas(), error: null }).then(ok, ko),
  }
  return q
}

import { crearSujeto, actualizarSujeto } from './compliance-sujetos'
import { crearDocumento, actualizarDocumento } from './compliance-documentos'

const SUJETO = { tipo: 'proveedor', documento_tipo: 'NIT', documento_numero: '900123456', nombre: 'Acme SAS' }
const DOC = { codigo: 'MAN-01', tipo: 'manual', nombre: 'Manual SAGRILAFT' }

beforeEach(() => {
  escrituras.length = 0
})

describe('crearSujeto — referencias', () => {
  it('con referencias propias se crea', async () => {
    const r = await crearSujeto({ ...SUJETO, staff_id: 'staff-propio', segmento_id: 'seg-propio', responsable_profile_id: 'user-1' })
    expect(r.ok).toBe(true)
    expect(escrituras.filter((e) => e.tabla === 'compliance_sujetos')).toHaveLength(1)
  })

  it.each([
    ['staff_id', { staff_id: 'staff-ajeno' }],
    ['segmento_id', { segmento_id: 'seg-ajeno' }],
    ['responsable_profile_id', { responsable_profile_id: 'user-ajeno' }],
  ])('con %s de otro workspace no se crea', async (_campo, refs) => {
    const r = await crearSujeto({ ...SUJETO, ...refs })
    expect(r.ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })
})

describe('actualizarSujeto — referencias', () => {
  it('con un segmento propio se actualiza', async () => {
    const r = await actualizarSujeto({ id: 'suj-1', segmento_id: 'seg-propio' })
    expect(r.ok).toBe(true)
    expect(escrituras).toHaveLength(1)
  })

  it.each([
    ['segmento_id', { segmento_id: 'seg-ajeno' }],
    ['responsable_profile_id', { responsable_profile_id: 'user-ajeno' }],
  ])('con %s de otro workspace no se actualiza', async (_campo, refs) => {
    const r = await actualizarSujeto({ id: 'suj-1', ...refs })
    expect(r.ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })
})

describe('documentos del expediente — cargo responsable', () => {
  it('con un cargo propio se crea', async () => {
    const r = await crearDocumento({ ...DOC, responsable_cargo_id: 'cargo-propio' })
    expect(r.ok).toBe(true)
    expect(escrituras).toHaveLength(1)
  })

  it('con un cargo de otro workspace no se crea', async () => {
    const r = await crearDocumento({ ...DOC, responsable_cargo_id: 'cargo-ajeno' })
    expect(r).toEqual({ ok: false, error: 'cargo_no_encontrado' })
    expect(escrituras).toHaveLength(0)
  })

  it('con un cargo de otro workspace no se actualiza', async () => {
    const r = await actualizarDocumento({ id: 'doc-1', responsable_cargo_id: 'cargo-ajeno' })
    expect(r).toEqual({ ok: false, error: 'cargo_no_encontrado' })
    expect(escrituras).toHaveLength(0)
  })
})
