import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de `recordatorios_log`, ejecutada en PGlite. Vera §7.2.1: la llave única con
 * `fecha_objetivo` es la idempotencia del motor (el reclamo `on conflict do nothing` de `motor.ts`
 * se apoya en ella). Y es server-only: ni `anon` ni `authenticated` la tocan.
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez sobre la migración:
 *   · quitar `fecha_objetivo` de la llave → cae «una fecha nueva rearma»;
 *   · quitar el `revoke all` → cae «nadie de la sesión la toca» (el esquema base imita el
 *     default viejo que concedía todo).
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261012160000_recordatorios_log.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const NEG = '00000000-0000-4000-8000-0000000000b1'
const ENT = '00000000-0000-4000-8000-0000000000c1'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table public.workspaces (id uuid primary key);
    create table public.negocios (id uuid primary key, workspace_id uuid);
    insert into public.workspaces values ('${WS}');
    insert into public.negocios values ('${NEG}', '${WS}');
  `)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
}, 30_000)

afterAll(async () => {
  await db.close()
})

const reclamar = (fecha: string, canal = 'in_app') =>
  db.query<{ id: string }>(
    `insert into public.recordatorios_log
       (workspace_id, negocio_id, regla_id, entidad_tipo, entidad_id, fecha_objetivo, destinatario, canal)
     values ($1, $2, 'prov_t3', 'servicio', $3, $4, 'p-alejandra', $5)
     on conflict on constraint recordatorios_log_una_vez do nothing
     returning id`,
    [WS, NEG, ENT, fecha, canal],
  )

describe('recordatorios_log', () => {
  it('el segundo reclamo del mismo aviso no devuelve fila', async () => {
    expect((await reclamar('2026-10-16')).rows).toHaveLength(1)
    expect((await reclamar('2026-10-16')).rows).toHaveLength(0)
  })

  it('una fecha nueva rearma; otro canal es otro aviso', async () => {
    expect((await reclamar('2026-10-23')).rows).toHaveLength(1)
    expect((await reclamar('2026-10-16', 'email')).rows).toHaveLength(1)
  })

  it('canal, estado e intentos con CHECK', async () => {
    await expect(reclamar('2026-11-01', 'paloma')).rejects.toThrow(/check/i)
    await expect(db.query(`update public.recordatorios_log set intentos = 4`)).rejects.toThrow(/check/i)
    await expect(db.query(`update public.recordatorios_log set estado = 'raro'`)).rejects.toThrow(/check/i)
  })

  it('nadie de la sesión la toca (server-only) y tiene RLS', async () => {
    const r = await db.query<{ rol: string; s: boolean; i: boolean }>(`
      select rol,
             has_table_privilege(rol, 'public.recordatorios_log', 'select') as s,
             has_table_privilege(rol, 'public.recordatorios_log', 'insert') as i
        from unnest(array['anon', 'authenticated']) as rol`)
    expect(r.rows.every((x) => !x.s && !x.i)).toBe(true)
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.recordatorios_log'::regclass`,
    )
    expect(rls.rows[0].relrowsecurity).toBe(true)
  })
})
