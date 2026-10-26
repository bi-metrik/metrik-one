/**
 * Identificación del remitente del bot por `wa_collaborators`.
 *
 * El bug (2026-10-01, producción): la consulta pedía `role`, columna que `wa_collaborators` no
 * tiene. PostgREST devolvía 42703, el error se ignoraba y el primer colaborador real (trappvel)
 * caía como «número desconocido». El cliente falso de abajo imita a PostgREST: si el `select`
 * nombra una columna que no existe en la tabla, responde 42703 como en producción. Las columnas
 * de la tabla se leen de las migraciones del repo, no de una lista copiada aquí.
 *
 * VISTO FALLAR: con `role` de vuelta en `COLUMNAS_COLABORADOR`, caen la de las columnas y las
 * tres de identificación del colaborador (devuelve null, como en producción).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COLUMNAS_COLABORADOR, identificarRemitente } from './wa-identificar'

const MIGRACIONES = join(__dirname, '..', '..', 'migrations')

/** Columnas de `wa_collaborators` según las migraciones (CREATE TABLE + ADD/DROP COLUMN). */
function columnasDeLaTabla(): Set<string> {
  const archivos = readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort()
  const cols = new Set<string>()
  for (const f of archivos) {
    const sql = readFileSync(join(MIGRACIONES, f), 'utf8')
    const create = /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?wa_collaborators\s*\(([\s\S]*?)\n\);/i.exec(sql)
    if (create) {
      for (const linea of create[1].split('\n')) {
        const m = /^\s*([a-z_][a-z0-9_]*)\s+[A-Z]/i.exec(linea)
        if (m && !/^(constraint|primary|unique|foreign|check)$/i.test(m[1])) cols.add(m[1])
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE(?: IF EXISTS)?\s+(?:public\.)?wa_collaborators\s+ADD COLUMN(?: IF NOT EXISTS)?\s+([a-z_]+)/gi)) cols.add(m[1])
    for (const m of sql.matchAll(/ALTER TABLE(?: IF EXISTS)?\s+(?:public\.)?wa_collaborators\s+DROP COLUMN(?: IF EXISTS)?\s+([a-z_]+)/gi)) cols.delete(m[1])
  }
  return cols
}

const COLUMNAS_REALES = columnasDeLaTabla()

/** Columnas de `staff` según los tipos generados de producción. */
const COLUMNAS_STAFF = new Set(['id', 'workspace_id', 'full_name', 'phone_whatsapp', 'profile_id', 'is_active', 'es_principal', 'tipo_acceso'])

/** Lo que devuelve `wa_identify_user` según `src/types/database.ts` (la definición viva). */
const COLUMNAS_RPC = (() => {
  const tipos = readFileSync(join(__dirname, '..', '..', '..', 'src', 'types', 'database.ts'), 'utf8')
  const bloque = /wa_identify_user: \{[\s\S]*?Returns: \{([\s\S]*?)\}\[\]/.exec(tipos)?.[1] ?? ''
  return [...bloque.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort()
})()

type Fila = Record<string, unknown>

/** Cliente falso que responde como PostgREST: 42703 si se pide una columna que no existe. */
function clienteFalso(opts: {
  /** Filas que devuelve `wa_identify_user`: con la forma REAL de producción (sin `user_id` ni id del staff). */
  staff?: Fila[]
  /** La tabla `staff` (id, workspace_id, full_name, phone_whatsapp, profile_id). */
  tablaStaff?: Fila[]
  colaboradores?: Fila[]
  workspaces?: Fila[]
  errorColaboradores?: { code: string; message: string }
}) {
  return {
    rpc: async () => ({ data: opts.staff ?? [], error: null }),
    from(tabla: string) {
      let columnas: string[] = []
      const filtros: Array<(f: Fila) => boolean> = []
      const q = {
        select(cols: string) { columnas = cols.split(',').map((c) => c.trim()); return q },
        eq(col: string, val: unknown) { filtros.push((f) => f[col] === val); return q },
        or(expr: string) {
          const valores = expr.split(',').map((p) => p.replace(/^phone\.eq\./, ''))
          filtros.push((f) => valores.includes(String(f.phone)))
          return q
        },
        limit() { return q },
        then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) {
          return Promise.resolve(resolverLista()).then(ok, ko)
        },
        async maybeSingle() { return resolver() },
        async single() { return resolver() },
      }
      function resolverLista() {
        if (tabla !== 'staff') throw new Error(`lista inesperada de ${tabla}`)
        const faltante = columnas.find((c) => !COLUMNAS_STAFF.has(c))
        if (faltante) return { data: null, error: { code: '42703', message: `column staff.${faltante} does not exist` } }
        return { data: (opts.tablaStaff ?? []).filter((f) => filtros.every((fn) => fn(f))), error: null }
      }
      function resolver() {
        if (tabla === 'wa_collaborators') {
          if (opts.errorColaboradores) return { data: null, error: opts.errorColaboradores }
          const faltante = columnas.find((c) => !COLUMNAS_REALES.has(c))
          if (faltante) {
            return { data: null, error: { code: '42703', message: `column wa_collaborators.${faltante} does not exist` } }
          }
          const fila = (opts.colaboradores ?? []).find((f) => filtros.every((fn) => fn(f)))
          return { data: fila ?? null, error: null }
        }
        if (tabla === 'workspaces') {
          const fila = (opts.workspaces ?? []).find((f) => filtros.every((fn) => fn(f)))
          return { data: fila ?? null, error: fila ? null : { code: 'PGRST116', message: 'no rows' } }
        }
        throw new Error(`tabla inesperada ${tabla}`)
      }
      return q
    },
  }
}

/** Una fila de `wa_identify_user` con SOLO las columnas que devuelve en producción. */
function filaRpc(f: { full_name: string; phone_whatsapp: string; es_principal?: boolean }): Fila {
  return { workspace_id: 'ws-trappvel', es_principal: false, tipo_acceso: 'ambos', ...f }
}

const TRAPPVEL = { id: 'ws-trappvel', subscription_status: 'trial', modules: { business: true } }
const TATIANA = {
  id: 'col-1', workspace_id: 'ws-trappvel', name: 'Tatiana', phone: '+573114559030', is_active: true,
}

afterEach(() => vi.restoreAllMocks())

describe('identificarRemitente por wa_collaborators', () => {
  it('las migraciones declaran la tabla (si no, la prueba no prueba nada)', () => {
    expect(COLUMNAS_REALES.has('phone')).toBe(true)
    expect(COLUMNAS_REALES.has('is_active')).toBe(true)
  })

  it('solo pide columnas que existen en wa_collaborators', () => {
    const faltantes = COLUMNAS_COLABORADOR.filter((c) => !COLUMNAS_REALES.has(c))
    expect(faltantes).toEqual([])
  })

  it('reconoce al colaborador guardado con «+» como operator, sin user_id', async () => {
    const sb = clienteFalso({ colaboradores: [TATIANA], workspaces: [TRAPPVEL] })
    const user = await identificarRemitente(sb, '573114559030')
    expect(user).toEqual({
      workspace_id: 'ws-trappvel',
      phone: '573114559030',
      name: 'Tatiana',
      role: 'operator',
      collaborator_id: 'col-1',
      subscription_status: 'trial',
      modulos: TRAPPVEL,
    })
    expect(user?.user_id).toBeUndefined()
  })

  it('reconoce al colaborador guardado sin «+» y con el teléfono entrante formateado', async () => {
    const sb = clienteFalso({ colaboradores: [{ ...TATIANA, phone: '573114559030' }], workspaces: [TRAPPVEL] })
    const user = await identificarRemitente(sb, '+57 311 455 9030')
    expect(user?.collaborator_id).toBe('col-1')
  })

  it('un colaborador inactivo no entra', async () => {
    const sb = clienteFalso({ colaboradores: [{ ...TATIANA, is_active: false }], workspaces: [TRAPPVEL] })
    expect(await identificarRemitente(sb, '573114559030')).toBeNull()
  })

  it('el staff gana sobre el colaborador', async () => {
    const sb = clienteFalso({
      staff: [filaRpc({ full_name: 'Dueña', phone_whatsapp: '+573114559030', es_principal: true })],
      tablaStaff: [{ id: 'st-duena', workspace_id: 'ws-trappvel', full_name: 'Dueña', phone_whatsapp: '+573114559030', profile_id: 'p-duena' }],
      colaboradores: [TATIANA],
      workspaces: [TRAPPVEL],
    })
    const user = await identificarRemitente(sb, '573114559030')
    expect(user?.role).toBe('owner')
    expect(user?.user_id).toBe('p-duena')
    expect(user?.collaborator_id).toBeUndefined()
  })

  it('un error de la consulta de colaboradores queda en el log, no se traga', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sb = clienteFalso({ errorColaboradores: { code: '42703', message: 'column x does not exist' }, workspaces: [TRAPPVEL] })
    expect(await identificarRemitente(sb, '573114559030')).toBeNull()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('42703'))
  })

  it('wa-webhook identifica con esta función', () => {
    const fuente = readFileSync(join(__dirname, '..', 'wa-webhook', 'index.ts'), 'utf8')
    expect(fuente).toMatch(/return identificarRemitente\(supabase, phone\)/)
    expect(fuente).not.toMatch(/from\('wa_collaborators'\)/)
  })
})

/**
 * El bug del 2026-10-22: `wa_identify_user` no devuelve `user_id` ni el id del staff, y el código lo leía de ahí. Todo
 * remitente del equipo quedaba sin perfil: los viajes del bot con `assigned_by` nulo y la campanita sin autor.
 * VISTO FALLAR: con `user_id: staffMatch.user_id || undefined` de vuelta (y sin `leerStaff`), caen las tres primeras.
 */
describe('identificarRemitente por staff (forma real de wa_identify_user)', () => {
  const EDGAR = { id: 'st-edgar', workspace_id: 'ws-trappvel', full_name: 'Edgar Alba', phone_whatsapp: '+57 310 000 0001', profile_id: 'p-edgar' }

  it('el doble de la RPC tiene exactamente las columnas de producción', () => {
    expect(COLUMNAS_RPC).toEqual(['es_principal', 'full_name', 'phone_whatsapp', 'tipo_acceso', 'workspace_id'])
    expect(Object.keys(filaRpc({ full_name: 'x', phone_whatsapp: 'y' })).sort()).toEqual(COLUMNAS_RPC)
  })

  it('resuelve el staff y su perfil por el teléfono que devolvió la RPC', async () => {
    const sb = clienteFalso({
      staff: [filaRpc({ full_name: 'Edgar Alba', phone_whatsapp: EDGAR.phone_whatsapp, es_principal: true })],
      tablaStaff: [EDGAR, { ...EDGAR, id: 'st-otro-ws', workspace_id: 'ws-otro', profile_id: 'p-otro' }],
      workspaces: [TRAPPVEL],
    })
    const user = await identificarRemitente(sb, '573100000001')
    expect(user?.staff_id).toBe('st-edgar')
    expect(user?.user_id).toBe('p-edgar')
  })

  it('dos staff con el mismo teléfono en el workspace: desempata el nombre', async () => {
    const sb = clienteFalso({
      staff: [filaRpc({ full_name: 'Edgar Alba', phone_whatsapp: EDGAR.phone_whatsapp })],
      tablaStaff: [{ ...EDGAR, id: 'st-homonimo', full_name: 'Otra Persona', profile_id: 'p-x' }, EDGAR],
      workspaces: [TRAPPVEL],
    })
    const user = await identificarRemitente(sb, '573100000001')
    expect(user?.staff_id).toBe('st-edgar')
  })

  it('staff sin perfil: entra con su staff, sin user_id', async () => {
    const sb = clienteFalso({
      staff: [filaRpc({ full_name: 'Edgar Alba', phone_whatsapp: EDGAR.phone_whatsapp })],
      tablaStaff: [{ ...EDGAR, profile_id: null }],
      workspaces: [TRAPPVEL],
    })
    const user = await identificarRemitente(sb, '573100000001')
    expect(user?.staff_id).toBe('st-edgar')
    expect(user?.user_id).toBeUndefined()
  })

  it('sin fila de staff que cruce: sigue entrando (sin autor), no se cae', async () => {
    const sb = clienteFalso({
      staff: [filaRpc({ full_name: 'Edgar Alba', phone_whatsapp: EDGAR.phone_whatsapp })],
      tablaStaff: [],
      workspaces: [TRAPPVEL],
    })
    const user = await identificarRemitente(sb, '573100000001')
    expect(user?.name).toBe('Edgar Alba')
    expect(user?.staff_id).toBeUndefined()
    expect(user?.user_id).toBeUndefined()
  })
})
