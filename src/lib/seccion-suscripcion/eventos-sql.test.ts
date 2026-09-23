import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de `sugerencias_eventos`, ejecutada de verdad en PGlite: server-only (ni `anon` ni
 * `authenticated` la leen ni la escriben, aunque los privilegios por defecto repliquen producción),
 * RLS encendido, y los CHECK que impiden un evento inventado o un origen fuera del clic.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20260924080000_sugerencias_eventos.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const PERFIL = '00000000-0000-4000-8000-0000000000d1'

const ESQUEMA_BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como producción antes del 2026-08-10: toda tabla nueva nacía concedida. La migración tiene que revocar.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.workspaces (id uuid primary key);
  create table public.profiles (id uuid primary key);
  insert into public.workspaces values ('${WS}');
  insert into public.profiles values ('${PERFIL}');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.query(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const insertar = (evento: string, origen: string | null) =>
  `insert into public.sugerencias_eventos (workspace_id, profile_id, clave, evento, origen)
   values ('${WS}', '${PERFIL}', 'sustenta', '${evento}', ${origen === null ? 'null' : `'${origen}'`})`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

afterAll(async () => {
  await db.close()
})

describe('sugerencias_eventos', () => {
  it('RLS encendido', async () => {
    const r = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'sugerencias_eventos'`,
    )
    expect(r.rows[0].relrowsecurity).toBe(true)
  })

  it('server-only: ni anon ni authenticated la leen ni la escriben', async () => {
    const r = await db.query<{ rol: string; s: boolean; i: boolean }>(`
      select rol,
             has_table_privilege(rol, 'public.sugerencias_eventos', 'select') as s,
             has_table_privilege(rol, 'public.sugerencias_eventos', 'insert') as i
        from unnest(array['anon', 'authenticated']) as rol`)
    for (const f of r.rows) {
      expect(f.s, f.rol).toBe(false)
      expect(f.i, f.rol).toBe(false)
    }
  })

  it('acepta los cuatro eventos, y el clic con su origen', async () => {
    for (const e of ['vista', 'panel', 'descarte']) expect(await falla(insertar(e, null))).toBeNull()
    expect(await falla(insertar('cta', 'tarjeta'))).toBeNull()
    expect(await falla(insertar('cta', 'panel'))).toBeNull()
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.sugerencias_eventos`)
    expect(r.rows[0].n).toBe(5)
  })

  it('rechaza un evento inventado', async () => {
    expect(await falla(insertar('compra', null))).toMatch(/sugerencias_eventos_evento/)
  })

  it('el origen solo existe en el clic, y el clic lo exige', async () => {
    expect(await falla(insertar('cta', null))).toMatch(/sugerencias_eventos_origen/)
    expect(await falla(insertar('cta', 'correo'))).toMatch(/sugerencias_eventos_origen/)
    expect(await falla(insertar('vista', 'tarjeta'))).toMatch(/sugerencias_eventos_origen/)
  })
})
