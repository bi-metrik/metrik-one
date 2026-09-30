import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de `secop_registros`, ejecutada de verdad en PGlite.
 *
 * Lo que se prueba y por qué cada cosa importa:
 *   * es server-only (ni `anon` ni `authenticated` la leen), y eso hay que REVOCARLO en la
 *     migración porque en esta base las tablas nuevas nacían concedidas;
 *   * la identificación es única **entre los creados** y un intento NO quema el NIT: si quemara,
 *     un tercero bloquearía a cualquiera escribiendo su NIT en el formulario y abandonando;
 *   * un `creado` sin workspace, sin slug o sin identificación no entra.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20260929090000_registro_secop_autogestion.sql')
const WS1 = '00000000-0000-4000-8000-0000000000a1'
const WS2 = '00000000-0000-4000-8000-0000000000a2'

const ESQUEMA_BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como producción antes del 2026-08-10: toda tabla nueva nacía concedida. La migración revoca.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.workspaces (id uuid primary key);
  insert into public.workspaces values ('${WS1}'), ('${WS2}');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.query(sql)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const creado = (correo: string, id: string, ws: string, slug: string) =>
  `insert into public.secop_registros (correo, correo_dominio, identificacion, workspace_id, slug_creado, estado)
   values ('${correo}', split_part('${correo}', '@', 2), '${id}', '${ws}', '${slug}', 'creado')`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('secop_registros', () => {
  it('nace con RLS y sin una sola policy (deny-all)', async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.secop_registros'::regclass`,
    )
    expect(rls.rows[0].relrowsecurity).toBe(true)
    const pol = await db.query<{ n: number }>(
      `select count(*)::int n from pg_policies where tablename = 'secop_registros'`,
    )
    expect(pol.rows[0].n).toBe(0)
  })

  it('ni anon ni authenticated la pueden leer; service_role sí', async () => {
    const r = await db.query<{ rol: string; lee: boolean; escribe: boolean }>(
      `select rol,
              has_table_privilege(rol, 'public.secop_registros', 'select') lee,
              has_table_privilege(rol, 'public.secop_registros', 'insert') escribe
         from (values ('anon'), ('authenticated'), ('service_role')) v(rol)`,
    )
    const por = Object.fromEntries(r.rows.map((f) => [f.rol, f]))
    expect(por.anon.lee).toBe(false)
    expect(por.anon.escribe).toBe(false)
    expect(por.authenticated.lee).toBe(false)
    expect(por.authenticated.escribe).toBe(false)
    expect(por.service_role.lee).toBe(true)
    expect(por.service_role.escribe).toBe(true)
  })

  it('un solo espacio por identificación', async () => {
    await db.exec(creado('alex@fabri.co', '900111222', WS1, 'fabri'))
    const e = await falla(creado('otro@fabri.co', '900111222', WS2, 'fabri-dos'))
    expect(e).toMatch(/secop_registros_identificacion_creada|duplicate key/i)
  })

  it('un solo espacio por correo, comparado sin distinguir mayúsculas', async () => {
    const e = await falla(creado('ALEX@Fabri.co', '900333444', WS2, 'fabri-tres'))
    expect(e).toMatch(/secop_registros_correo_creado|duplicate key/i)
  })

  // Si un intento quemara el NIT, cualquiera bloquearía a una empresa escribiendo su NIT en el
  // formulario y abandonando. Solo el espacio CREADO toma la llave.
  it('un intento o un rechazo NO queman la identificación', async () => {
    await db.exec(
      `insert into public.secop_registros (correo, correo_dominio, identificacion, estado)
       values ('a@x.com', 'x.com', '900555666', 'intento'),
              ('b@x.com', 'x.com', '900555666', 'rechazado'),
              ('c@x.com', 'x.com', '900555666', 'intento')`,
    )
    expect(await falla(creado('d@x.com', '900555666', WS2, 'equis'))).toBeNull()
  })

  it('un intento puede no declarar identificación', async () => {
    expect(
      await falla(
        `insert into public.secop_registros (correo, correo_dominio, estado)
         values ('sin-nit@x.com', 'x.com', 'intento')`,
      ),
    ).toBeNull()
  })

  it('un creado sin espacio, sin slug o sin identificación no entra', async () => {
    const sinWs = await falla(
      `insert into public.secop_registros (correo, correo_dominio, identificacion, slug_creado, estado)
       values ('e@x.com', 'x.com', '900777888', 'eq', 'creado')`,
    )
    expect(sinWs).toMatch(/secop_registros_creado_tiene_espacio/)
    const sinId = await falla(
      `insert into public.secop_registros (correo, correo_dominio, workspace_id, slug_creado, estado)
       values ('f@x.com', 'x.com', '${WS2}', 'eq2', 'creado')`,
    )
    expect(sinId).toMatch(/secop_registros_creado_tiene_espacio/)
  })

  it('solo acepta los tres estados del flujo', async () => {
    expect(
      await falla(
        `insert into public.secop_registros (correo, correo_dominio, estado)
         values ('g@x.com', 'x.com', 'pendiente')`,
      ),
    ).toMatch(/secop_registros_estado_check/)
  })

  // La medición del experimento (§0-quater: «poder ver cuántos espacios se crearon») sale de
  // contar por estado. Que la consulta funcione es parte del entregable.
  it('se puede contar cuántos se crearon y cuántos se rechazaron', async () => {
    const r = await db.query<{ estado: string; n: number }>(
      `select estado, count(*)::int n from public.secop_registros group by estado order by estado`,
    )
    const por = Object.fromEntries(r.rows.map((f) => [f.estado, f.n]))
    expect(por.creado).toBe(2)
    expect(por.rechazado).toBe(1)
    expect(por.intento).toBe(3)
  })
})
