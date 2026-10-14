import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/** La migración de `cobro_intentos_tarjeta`, ejecutada de verdad en PGlite. */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261014153000_cobro_intentos_tarjeta.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const PLAN = '00000000-0000-4000-8000-0000000000a2'
const COBRO = '00000000-0000-4000-8000-0000000000a3'
const OTRO_COBRO = '00000000-0000-4000-8000-0000000000a4'

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.query(sql)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const fila = (cobro: string, intento: number) =>
  `insert into public.cobro_intentos_tarjeta (workspace_id, cobro_id, plan_cobro_id, numero_cuota, intento)
   values ('${WS}', '${cobro}', '${PLAN}', 2, ${intento})`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('cobro_intentos_tarjeta', () => {
  it('un intento por cuota y por día, aunque venga con otra fila de cobro', async () => {
    expect(await falla(fila(COBRO, 0))).toBeNull()
    expect(await falla(fila(OTRO_COBRO, 0))).toMatch(/cobro_intentos_tarjeta_uno_por_dia|duplicate key/)
    expect(await falla(fila(COBRO, 1))).toBeNull()
    expect(await falla(fila(COBRO, 3))).toMatch(/check/)
  })

  it('nace en curso y solo admite los resultados conocidos', async () => {
    const r = await db.query<{ resultado: string }>(`select resultado from public.cobro_intentos_tarjeta where intento = 0`)
    expect(r.rows[0].resultado).toBe('en_curso')
    expect(await falla(`update public.cobro_intentos_tarjeta set resultado = 'quizas' where intento = 0`)).toMatch(/check/)
  })

  it('server-only: RLS sin policy y sin privilegios para anon ni authenticated', async () => {
    const r = await db.query<{ rls: boolean; anon: boolean; auth: boolean; svc: boolean }>(
      `select (select relrowsecurity from pg_class where oid = 'public.cobro_intentos_tarjeta'::regclass) rls,
              has_table_privilege('anon', 'public.cobro_intentos_tarjeta', 'select') anon,
              has_table_privilege('authenticated', 'public.cobro_intentos_tarjeta', 'select') auth,
              has_table_privilege('service_role', 'public.cobro_intentos_tarjeta', 'insert') svc`,
    )
    expect(r.rows[0]).toEqual({ rls: true, anon: false, auth: false, svc: true })
  })
})
