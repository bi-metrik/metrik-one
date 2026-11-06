import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * `20261026090000_valida_consultas_solo_servidor.sql` en PGlite, sobre el estado que tenia produccion
 * (grants por defecto de Supabase + las politicas de 20260506100001/20260831000005): despues de la
 * migracion una sesion sigue LEYENDO su historial de Valida, pero ya no puede insertar, cambiar ni
 * borrar filas, ni de su espacio ni de otro. service_role (el servidor) escribe igual.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261026090000_valida_consultas_solo_servidor.sql')
const WS1 = '00000000-0000-4000-8000-0000000000a1'
const WS2 = '00000000-0000-4000-8000-0000000000a2'

let db: PGlite

async function comoSesion<T>(ws: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set app.ws = '${ws}'; set role authenticated;`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role;')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create function public.current_user_workspace_id() returns uuid language sql stable
      as $$ select nullif(current_setting('app.ws', true), '')::uuid $$;
    grant execute on function public.current_user_workspace_id() to authenticated;
    create table public.valida_consultas (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null,
      severidad text not null
    );
    -- Lo que habia en produccion: grants por defecto y las tres politicas.
    grant all on public.valida_consultas to anon, authenticated, service_role;
    alter table public.valida_consultas enable row level security;
    create policy valida_consultas_select on public.valida_consultas
      for select using ((workspace_id = ( select current_user_workspace_id())));
    create policy valida_consultas_insert on public.valida_consultas
      for insert with check ((workspace_id = ( select current_user_workspace_id())));
    create policy valida_consultas_update on public.valida_consultas
      for update using ((workspace_id = ( select current_user_workspace_id())));
    insert into public.valida_consultas (workspace_id, severidad) values
      ('${WS1}', 'alto'), ('${WS2}', 'medio');
  `)
})

afterAll(async () => {
  await db.close()
})

describe('antes de la migracion (el hallazgo)', () => {
  it('una sesion podia cambiar la severidad de una consulta de su espacio', async () => {
    const r = await comoSesion(WS1, () =>
      db.query(`update public.valida_consultas set severidad = 'sin_hallazgo' where workspace_id = '${WS1}' returning id`),
    )
    expect(r.rows).toHaveLength(1)
    await db.exec(`update public.valida_consultas set severidad = 'alto' where workspace_id = '${WS1}'`)
  })
})

describe('despues de la migracion', () => {
  beforeAll(async () => {
    await db.exec(readFileSync(MIGRACION, 'utf8'))
  })

  it('la sesion sigue leyendo SOLO su historial', async () => {
    const r = await comoSesion(WS1, () => db.query<{ severidad: string }>('select severidad from public.valida_consultas'))
    expect(r.rows.map((f) => f.severidad)).toEqual(['alto'])
  })

  it('la sesion no puede insertar, cambiar ni borrar', async () => {
    await expect(
      comoSesion(WS1, () => db.query(`insert into public.valida_consultas (workspace_id, severidad) values ('${WS1}', 'sin_hallazgo')`)),
    ).rejects.toThrow(/permission denied/)
    await expect(
      comoSesion(WS1, () => db.query(`update public.valida_consultas set severidad = 'sin_hallazgo' where workspace_id = '${WS1}'`)),
    ).rejects.toThrow(/permission denied/)
    await expect(
      comoSesion(WS1, () => db.query(`delete from public.valida_consultas where workspace_id = '${WS1}'`)),
    ).rejects.toThrow(/permission denied/)
    const r = await db.query<{ severidad: string }>(`select severidad from public.valida_consultas where workspace_id = '${WS1}'`)
    expect(r.rows.map((f) => f.severidad)).toEqual(['alto'])
  })

  it('anon no lee nada', async () => {
    await db.exec('set role anon;')
    try {
      await expect(db.query('select 1 from public.valida_consultas')).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role;')
    }
  })

  it('el servidor (service_role) escribe igual', async () => {
    await db.exec('set role service_role;')
    try {
      const r = await db.query(`insert into public.valida_consultas (workspace_id, severidad) values ('${WS2}', 'bajo') returning id`)
      expect(r.rows).toHaveLength(1)
    } finally {
      await db.exec('reset role;')
    }
  })

  it('las politicas de escritura ya no existen; la de lectura si', async () => {
    const r = await db.query<{ policyname: string }>(
      `select policyname from pg_policies where tablename = 'valida_consultas' order by 1`,
    )
    expect(r.rows.map((f) => f.policyname)).toEqual(['valida_consultas_select'])
  })
})
