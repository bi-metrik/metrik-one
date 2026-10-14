import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de los documentos del viajero en el contacto (F4, PR 11; Vera C11), en PGlite.
 *
 * Criterios: RLS por workspace con grant a `authenticated` (la sesión lee y escribe), nada para
 * `anon`, sin delete para la sesión (nada se borra, §7.2.4), archivo como `one://` (F0-6) y el
 * mismo documento vigente una sola vez por contacto.
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez sobre la migración:
 *   · quitar el índice `contacto_documentos_vigente_unico` → cae «el mismo pasaporte no se duplica»;
 *   · policy con `using (true)` → cae «otro workspace no se ve»;
 *   · `grant ... delete` → cae «la sesión no borra».
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261012220000_contacto_documentos.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const WS2 = '00000000-0000-4000-8000-0000000000a2'
const CON = '00000000-0000-4000-8000-0000000000c1'
const CON2 = '00000000-0000-4000-8000-0000000000c2'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create function public.current_user_workspace_id() returns uuid language sql stable
      as $$ select nullif(current_setting('app.ws', true), '')::uuid $$;
    create table public.workspaces (id uuid primary key);
    create table public.contactos (id uuid primary key, workspace_id uuid);
    create table public.negocios (id uuid primary key);
    create table public.staff (id uuid primary key);
    insert into public.workspaces values ('${WS}'), ('${WS2}');
    insert into public.contactos values ('${CON}', '${WS}'), ('${CON2}', '${WS2}');
  `)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

afterAll(async () => {
  await db.close()
})

async function falla(sql: string): Promise<string | null> {
  try {
    await db.exec(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const doc = (o: { numero?: string | null; ref?: string | null; ws?: string; con?: string; vigente?: boolean } = {}) =>
  `insert into public.contacto_documentos (workspace_id, contacto_id, tipo, numero, archivo_ref, fecha_vencimiento, vigente)
   values ('${o.ws ?? WS}', '${o.con ?? CON}', 'pasaporte', ${o.numero === null ? 'null' : `'${o.numero ?? 'AB123456'}'`},
           ${o.ref === undefined ? `'one://ve-documentos/${WS}/pasaporte.png'` : o.ref === null ? 'null' : `'${o.ref}'`},
           '2027-03-02', ${o.vigente ?? true})`

describe('contacto_documentos', () => {
  it('guarda un pasaporte con su archivo one://', async () => {
    expect(await falla(doc())).toBeNull()
  })

  it('el mismo pasaporte vigente no se duplica; uno reemplazado sí convive', async () => {
    expect(await falla(doc())).toMatch(/duplicate|unique/i)
    expect(await falla(doc({ vigente: false }))).toBeNull()
  })

  it('un link pegado no es archivo', async () => {
    expect(await falla(doc({ numero: 'ZZ1', ref: 'https://drive.google.com/x' }))).toMatch(/check/i)
  })

  it('sin número ni archivo no se guarda', async () => {
    expect(await falla(doc({ numero: null, ref: null }))).toMatch(/contacto_documentos_con_algo/)
  })

  it('otro workspace no se ve, y la sesión no escribe en otro workspace', async () => {
    await db.exec(doc({ ws: WS2, con: CON2, numero: 'OTRO1' }))
    await db.exec(`set role authenticated; select set_config('app.ws', '${WS}', false);`)
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.contacto_documentos where workspace_id = $1', [WS2])
    expect(r.rows[0].n).toBe(0)
    expect(await falla(doc({ ws: WS2, con: CON2, numero: 'OTRO2' }))).toMatch(/row-level security|policy/i)
    await db.exec('reset role')
  })

  it('la sesión no borra; anon no la toca', async () => {
    await db.exec(`set role authenticated; select set_config('app.ws', '${WS}', false);`)
    expect(await falla('delete from public.contacto_documentos')).toMatch(/permission denied/i)
    await db.exec('reset role')
    await db.exec('set role anon')
    expect(await falla('select * from public.contacto_documentos')).toMatch(/permission denied/i)
    await db.exec('reset role')
  })
})
