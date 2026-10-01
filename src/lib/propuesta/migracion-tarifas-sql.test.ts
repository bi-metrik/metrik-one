import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Las dos migraciones de tarifas por plan y ruta, ejecutadas de verdad en PGlite: la tabla
 * (inmutable, sin escritura para `authenticated`) y la carga de SOENA (re-aplicable, que se
 * detiene si encuentra otra cosa). Las tablas de las que dependen se crean con lo mínimo,
 * no con su esquema real. Los ids son los de la configuración de SOENA porque la migración
 * los trae fijos; no hay datos de clientes.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const DDL = leer('20261001140000_servicio_tarifas_versiones.sql')
const CARGA = leer('20261001140100_soena_tarifas_plan_ruta.sql')

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const SERVICIO = '3d74c1a2-e6a3-4013-b006-4447851d90a4'

const OPCIONES = JSON.stringify({
  fields: [{ slug: 'servicio', opciones: [{ value: 'completo' }, { value: 'solo_upme' }, { value: 'solo_iva' }] }],
})

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key);
  create table public.servicios (id uuid primary key, workspace_id uuid);
  create table public.staff (id uuid primary key);
  create table public.bloque_configs (id uuid primary key default gen_random_uuid(), workspace_id uuid, slug text, config_extra jsonb);
  create function public.current_user_workspace_id() returns uuid language sql as $$ select '${WS}'::uuid $$;

  insert into public.workspaces (id) values ('${WS}');
  insert into public.servicios (id, workspace_id) values ('${SERVICIO}', '${WS}');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.exec(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(DDL)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('tabla servicio_tarifas_versiones', () => {
  it('tiene RLS, la lee authenticated y no la escribe nadie más que el servidor', async () => {
    const r = await db.query<{ rls: boolean; sel: boolean; ins: boolean; upd: boolean; anon: boolean }>(`
      select c.relrowsecurity as rls,
             has_table_privilege('authenticated', c.oid, 'select') as sel,
             has_table_privilege('authenticated', c.oid, 'insert') as ins,
             has_table_privilege('authenticated', c.oid, 'update') as upd,
             has_table_privilege('anon', c.oid, 'select') as anon
        from pg_class c where c.oid = 'public.servicio_tarifas_versiones'::regclass`)
    expect(r.rows[0]).toEqual({ rls: true, sel: true, ins: false, upd: false, anon: false })
  })

  it('la función del trigger no la ejecuta anon ni authenticated', async () => {
    const r = await db.query<{ a: boolean; b: boolean }>(`
      select has_function_privilege('anon', 'public.servicio_tarifas_inmutable()', 'execute') as a,
             has_function_privilege('authenticated', 'public.servicio_tarifas_inmutable()', 'execute') as b`)
    expect(r.rows[0]).toEqual({ a: false, b: false })
  })
})

describe('carga de SOENA', () => {
  it('sin el campo de rutas se detiene', async () => {
    expect(await falla(CARGA)).toMatch(/no ofrece completo\/solo_upme\/solo_iva/)
  })

  it('carga la versión 1 con la tabla del brief y es re-aplicable', async () => {
    await db.query(`insert into public.bloque_configs (workspace_id, slug, config_extra) values ($1, 'servicio_contratado', $2::jsonb)`, [WS, OPCIONES])
    await db.exec(CARGA)
    await db.exec(CARGA)
    const r = await db.query<{ version: number; vigente_desde: string; cap: string; planes: unknown; no_ofrece: unknown }>(`
      select version, vigente_desde::text, cap_descuento_pct::text as cap, planes, no_ofrece
        from public.servicio_tarifas_versiones where servicio_id = $1`, [SERVICIO])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ version: 1, vigente_desde: '2026-10-01', cap: '25.00' })
    expect(r.rows[0].planes).toEqual([
      { n: 1, nombre: 'Plan 1 (tarifa plena)', valor: 910000 },
      { n: 2, nombre: 'Plan 2 (pago anticipado)', valor: 682500 },
    ])
    expect(r.rows[0].no_ofrece).toEqual([{ plan: 1, ruta: 'solo_iva' }])
  })

  it('una versión no se edita ni se borra', async () => {
    expect(await falla(`update public.servicio_tarifas_versiones set cap_descuento_pct = 50`)).toMatch(/no se modifica ni se borra/)
    expect(await falla(`delete from public.servicio_tarifas_versiones`)).toMatch(/no se modifica ni se borra/)
  })

  it('el número de versión no se repite', async () => {
    expect(await falla(`
      insert into public.servicio_tarifas_versiones (workspace_id, servicio_id, version, vigente_desde, planes, rutas, cap_descuento_pct)
      values ('${WS}', '${SERVICIO}', 1, '2026-11-01', '[{"n":1}]', '[{"valor":"x"}]', 10)`)).toMatch(/servicio_tarifas_version_unica/)
  })

  it('si la primera versión ya es otra, la carga se detiene en vez de pisarla', async () => {
    const db2 = new PGlite()
    await db2.exec(ESQUEMA_BASE)
    await db2.exec(DDL)
    await db2.query(`insert into public.bloque_configs (workspace_id, slug, config_extra) values ($1, 'servicio_contratado', $2::jsonb)`, [WS, OPCIONES])
    await db2.exec(`
      insert into public.servicio_tarifas_versiones (workspace_id, servicio_id, version, vigente_desde, planes, rutas, cap_descuento_pct)
      values ('${WS}', '${SERVICIO}', 1, '2026-10-01', '[{"n":1,"nombre":"P","valor":1}]', '[{"valor":"completo","nombre":"C","pct":100}]', 25)`)
    await expect(db2.exec(CARGA)).rejects.toThrow(/No se pisan/)
    await db2.close()
  })
})
