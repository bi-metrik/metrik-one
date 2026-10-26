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

type Fila = Record<string, unknown>

/** Cliente falso que responde como PostgREST: 42703 si se pide una columna que no existe. */
function clienteFalso(opts: {
  staff?: Fila[]
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
        async maybeSingle() { return resolver() },
        async single() { return resolver() },
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
      staff: [{ workspace_id: 'ws-trappvel', full_name: 'Dueña', es_principal: true, user_id: 'u-1' }],
      colaboradores: [TATIANA],
      workspaces: [TRAPPVEL],
    })
    const user = await identificarRemitente(sb, '573114559030')
    expect(user?.role).toBe('owner')
    expect(user?.user_id).toBe('u-1')
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
