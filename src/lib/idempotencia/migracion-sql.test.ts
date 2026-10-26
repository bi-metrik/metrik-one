import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración `20261006150000_claves_idempotencia.sql`, ejecutada en PGlite:
 * la tabla server-only, el candado atómico con vencimiento, el purgado programado y el índice
 * único de los avisos de los crons (que NO choca con los pares viejos).
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261006150000_claves_idempotencia.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const P1 = '00000000-0000-4000-8000-0000000000b1'
const NEG = '00000000-0000-4000-8000-0000000000c1'

const ESQUEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint
    language sql as $$
      insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid $$;
  create function cron.unschedule(job_name text) returns boolean
    language sql as $$ delete from cron.job where jobname = job_name returning true $$;
  create table public.workspaces (id uuid primary key);
  create table public.notificaciones (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid, destinatario_id uuid not null, tipo text not null,
    estado text not null default 'pendiente', entidad_id uuid, contenido text,
    created_at timestamptz default now()
  );
  insert into public.workspaces values ('${WS}');
  -- Un par viejo (antes del corte) que la migración NO puede hacer fallar.
  insert into public.notificaciones (destinatario_id, tipo, entidad_id, created_at) values
    ('${P1}', 'inactividad_oportunidad', '${NEG}', '2026-09-01T12:00:00Z'),
    ('${P1}', 'inactividad_oportunidad', '${NEG}', '2026-09-01T12:00:03Z');
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

const aviso = (tipo: string, entidad: string | null, estado = 'pendiente') =>
  `insert into public.notificaciones (destinatario_id, tipo, entidad_id, estado)
   values ('${P1}', '${tipo}', ${entidad ? `'${entidad}'` : 'null'}, '${estado}')`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

afterAll(async () => {
  await db.close()
})

describe('claves_idempotencia', () => {
  it('nace con RLS y sin privilegios para anon ni authenticated', async () => {
    const { rows } = await db.query<{ rls: boolean }>(
      `select relrowsecurity as rls from pg_class where relname = 'claves_idempotencia'`)
    expect(rows[0].rls).toBe(true)
    const { rows: priv } = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_table_privilege('anon', 'public.claves_idempotencia', 'select') as anon,
              has_table_privilege('authenticated', 'public.claves_idempotencia', 'select') as auth`)
    expect(priv[0]).toEqual({ anon: false, auth: false })
  })

  it('la llave primaria rechaza la misma intención dos veces', async () => {
    const ins = `insert into public.claves_idempotencia (clave, ambito, nombre, vence_at) values ('k1', 'accion', 'x', now() + interval '1 day')`
    expect(await falla(ins)).toBeNull()
    expect(await falla(ins)).toMatch(/duplicate key/)
  })
})

describe('tomar_candado', () => {
  const tomar = async (clave: string, s = 900) =>
    (await db.query<{ t: boolean }>(`select public.tomar_candado($1, $2) as t`, [clave, s])).rows[0].t

  it('el primero lo toma; el segundo, con el candado vigente, no', async () => {
    expect(await tomar('cron:a')).toBe(true)
    expect(await tomar('cron:a')).toBe(false)
  })

  it('vencido, se vuelve a tomar', async () => {
    expect(await tomar('cron:b')).toBe(true)
    await db.query(`update public.claves_idempotencia set vence_at = now() - interval '1 second' where clave = 'cron:b'`)
    expect(await tomar('cron:b')).toBe(true)
  })

  it('no pisa una clave de ACCIÓN aunque esté vencida', async () => {
    await db.query(`insert into public.claves_idempotencia (clave, ambito, nombre, vence_at) values ('k-acc', 'accion', 'x', now() - interval '1 day')`)
    expect(await tomar('k-acc')).toBe(false)
  })

  it('no la ejecutan anon ni authenticated', async () => {
    const { rows } = await db.query<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon', 'public.tomar_candado(text, integer)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.tomar_candado(text, integer)', 'execute') as auth,
              has_function_privilege('service_role', 'public.tomar_candado(text, integer)', 'execute') as svc`)
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true })
  })
})

describe('purgado', () => {
  it('queda programado una vez, aunque la migración se corra dos veces', async () => {
    await db.exec(readFileSync(MIGRACION, 'utf8'))
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from cron.job where jobname = 'purgar-claves-idempotencia'`)
    expect(rows[0].n).toBe(1)
  })
})

describe('un aviso pendiente por (persona, tipo, entidad) en los avisos de crons', () => {
  it('el corte es el momento de aplicar: el índice no mira filas anteriores', async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_indexdef(indexrelid) as def from pg_index where indexrelid = 'public.notificaciones_pendiente_unica_de_cron'::regclass`)
    expect(rows[0].def).toMatch(/created_at >= '20\d\d-/)
  })

  it('el par viejo sigue ahí (la migración no lo borró ni falló por él)', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.notificaciones where created_at < '2026-10-01'`)
    expect(rows[0].n).toBe(2)
  })

  it('un segundo aviso pendiente nuevo choca', async () => {
    const N2 = '00000000-0000-4000-8000-0000000000c2'
    expect(await falla(aviso('inactividad_oportunidad', N2))).toBeNull()
    expect(await falla(aviso('inactividad_oportunidad', N2))).toMatch(/duplicate key/)
  })

  it('streak_roto sin entidad también choca (dos nulos cuentan como iguales)', async () => {
    expect(await falla(aviso('streak_roto', null))).toBeNull()
    expect(await falla(aviso('streak_roto', null))).toMatch(/duplicate key/)
  })

  it('uno completado no estorba al siguiente pendiente', async () => {
    const N3 = '00000000-0000-4000-8000-0000000000c3'
    expect(await falla(aviso('inactividad_proyecto', N3, 'completada'))).toBeNull()
    expect(await falla(aviso('inactividad_proyecto', N3))).toBeNull()
  })

  it('otros tipos (menciones, avisos de etapa) no quedan limitados', async () => {
    const N4 = '00000000-0000-4000-8000-0000000000c4'
    expect(await falla(aviso('mencion', N4))).toBeNull()
    expect(await falla(aviso('mencion', N4))).toBeNull()
  })
})
