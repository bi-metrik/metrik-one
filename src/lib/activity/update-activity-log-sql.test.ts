import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Quién puede EDITAR y BORRAR en `activity_log`, ejecutado de verdad en Postgres en memoria
 * (PGlite) con los ARCHIVOS de migración tal cual y `set role authenticated`, que es como
 * llega una petición de PostgREST con el JWT de un usuario.
 *
 * El hueco que cierra 20260928130000: con la política de UPDATE solo por workspace que dejó
 * #944, un miembro reescribía un `cambio_etapa` ajeno a `comentario` con su propio autor y
 * después lo borraba. El caso «control» carga solo #944 y comprueba que el ataque pasa; si
 * dejara de pasar, el resto de este archivo no probaría nada.
 *
 * Los helpers imitan a los de producción (20260730000010): SECURITY DEFINER, leen
 * `auth.uid()` del claim `sub` del JWT.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const BORRAR = '20260928120000_activity_log_borrar_solo_comentarios.sql'
const EDITAR = '20260928130000_activity_log_update_solo_correccion_propia.sql'

const WS = '00000000-0000-4000-8000-0000000000a1'
const WS_OTRO = '00000000-0000-4000-8000-0000000000a2'
// Personas (profile) y su staff.
const P_ANA = '00000000-0000-4000-8000-00000000b001' // operadora
const P_BETO = '00000000-0000-4000-8000-00000000b002' // operador
const P_ADMIN = '00000000-0000-4000-8000-00000000b003' // admin del workspace
const P_FORANEA = '00000000-0000-4000-8000-00000000b004' // activa en otro workspace
const S_ANA = '00000000-0000-4000-8000-00000000c001'
const S_BETO = '00000000-0000-4000-8000-00000000c002'
const S_ADMIN = '00000000-0000-4000-8000-00000000c003'
const S_FORANEA = '00000000-0000-4000-8000-00000000c004'
// Filas de actividad.
const COMENTARIO_ANA = '00000000-0000-4000-8000-00000000d001'
const COMENTARIO_BETO = '00000000-0000-4000-8000-00000000d002'
const ETAPA_BETO = '00000000-0000-4000-8000-00000000d003' // cambio_etapa ajeno
const CORRECCION_ANA = '00000000-0000-4000-8000-00000000d004' // tipo 'cambio' propio
const CORRECCION_BETO = '00000000-0000-4000-8000-00000000d005'
const CORRECCION_FORANEA = '00000000-0000-4000-8000-00000000d006' // de S_FORANEA en WS

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;

  create table public.profiles (id uuid primary key, workspace_id uuid, role text);
  create table public.staff (id uuid primary key, profile_id uuid, workspace_id uuid, is_active boolean default true);

  create function public.current_user_workspace_id() returns uuid language sql stable security definer
    set search_path = public, pg_temp as $$ select workspace_id from profiles where id = auth.uid() $$;
  create function public.current_user_staff_id() returns uuid language sql stable security definer
    set search_path = public, pg_temp as
    $$ select id from staff where profile_id = auth.uid() and is_active = true limit 1 $$;
  create function public.current_user_profile_role() returns text language sql stable security definer
    set search_path = public, pg_temp as $$ select role from profiles where id = auth.uid() $$;
  revoke execute on function public.current_user_staff_id() from public, anon;
  revoke execute on function public.current_user_profile_role() from public, anon;
  grant execute on function public.current_user_staff_id() to authenticated, service_role;
  grant execute on function public.current_user_profile_role() to authenticated, service_role;

  create table public.activity_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    entidad_tipo text not null,
    entidad_id uuid not null,
    tipo text not null check (tipo in ('comentario','cambio','cambio_etapa','sistema')),
    autor_id uuid references public.staff(id),
    campo_modificado text,
    valor_anterior text,
    valor_nuevo text,
    contenido text,
    mencion_id uuid,
    link_url text,
    created_at timestamptz default now()
  );
  -- Lo que Supabase da por defecto a las tablas de public.
  grant all on public.activity_log to anon, authenticated, service_role;
  alter table public.activity_log enable row level security;
  -- La política viva antes de #944 (20260330000000 + initplan de 20260831000004).
  create policy activity_log_workspace_isolation on public.activity_log
    for all using (workspace_id = (select public.current_user_workspace_id()));

  insert into public.profiles values
    ('${P_ANA}', '${WS}', 'operator'),
    ('${P_BETO}', '${WS}', 'operator'),
    ('${P_ADMIN}', '${WS}', 'admin'),
    ('${P_FORANEA}', '${WS_OTRO}', 'owner');
  insert into public.staff (id, profile_id, workspace_id) values
    ('${S_ANA}', '${P_ANA}', '${WS}'),
    ('${S_BETO}', '${P_BETO}', '${WS}'),
    ('${S_ADMIN}', '${P_ADMIN}', '${WS}'),
    ('${S_FORANEA}', '${P_FORANEA}', '${WS_OTRO}');
`

const NEGOCIO = '00000000-0000-4000-8000-0000000000e1'
const FILAS = `
  insert into public.activity_log (id, workspace_id, entidad_tipo, entidad_id, tipo, autor_id, campo_modificado, valor_anterior, valor_nuevo, contenido) values
    ('${COMENTARIO_ANA}',     '${WS}', 'negocio', '${NEGOCIO}', 'comentario',   '${S_ANA}',     null,    null, null,    'hola'),
    ('${COMENTARIO_BETO}',    '${WS}', 'negocio', '${NEGOCIO}', 'comentario',   '${S_BETO}',    null,    null, null,    'de beto'),
    ('${ETAPA_BETO}',         '${WS}', 'negocio', '${NEGOCIO}', 'cambio_etapa', '${S_BETO}',    'etapa', 'A',  'B',     'Paso a B'),
    ('${CORRECCION_ANA}',     '${WS}', 'negocio', '${NEGOCIO}', 'cambio',       '${S_ANA}',     'placa', '1',  '12',    'Corrigió placa'),
    ('${CORRECCION_BETO}',    '${WS}', 'negocio', '${NEGOCIO}', 'cambio',       '${S_BETO}',    'placa', '1',  '12',    'Corrigió placa'),
    ('${CORRECCION_FORANEA}', '${WS}', 'negocio', '${NEGOCIO}', 'cambio',       '${S_FORANEA}', 'placa', '1',  '12',    'Corrigió placa');
`

async function crearBase(migraciones: string[]): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  for (const m of migraciones) await db.exec(leer(m))
  await db.exec(FILAS)
  return db
}

/** Corre `sql` como el usuario `profileId` (PostgREST: rol authenticated + JWT). */
async function como(db: PGlite, profileId: string, sql: string): Promise<{ filas: number } | { error: string }> {
  try {
    const r = await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated`)
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: profileId, role: 'authenticated' })])
      return tx.query<{ n: number }>(`with x as (${sql} returning 1) select count(*)::int n from x`)
    })
    return { filas: r.rows[0].n }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

const bloqueado = (r: { filas: number } | { error: string }) => ('error' in r ? 'error' : r.filas)

describe('control: solo con #944 el hueco existe', () => {
  let db: PGlite
  beforeAll(async () => { db = await crearBase([BORRAR]) })
  afterAll(async () => { await db.close() })

  it('un operador reescribe un cambio_etapa ajeno a comentario propio y lo borra', async () => {
    expect(await como(db, P_ANA,
      `update public.activity_log set tipo = 'comentario', autor_id = '${S_ANA}' where id = '${ETAPA_BETO}'`,
    )).toEqual({ filas: 1 })
    expect(await como(db, P_ANA, `delete from public.activity_log where id = '${ETAPA_BETO}'`)).toEqual({ filas: 1 })
  })
})

describe('20260928130000: UPDATE solo del evento de corrección propio', () => {
  let db: PGlite
  beforeAll(async () => { db = await crearBase([BORRAR, EDITAR]) })
  afterAll(async () => { await db.close() })

  it('el único camino de la app: el autor refresca su corrección (actualizarActividad)', async () => {
    expect(await como(db, P_ANA,
      `update public.activity_log set valor_nuevo = '123', contenido = 'Corrigió placa: 1 → 123', valor_anterior = '1' where id = '${CORRECCION_ANA}'`,
    )).toEqual({ filas: 1 })
  })

  it('(a) nadie edita comentarios, ni el propio: la app no lo ofrece', async () => {
    expect(bloqueado(await como(db, P_ANA, `update public.activity_log set contenido = 'editado' where id = '${COMENTARIO_ANA}'`))).toBe(0)
  })

  it('(b) comentario ajeno: 0', async () => {
    expect(bloqueado(await como(db, P_ANA, `update public.activity_log set contenido = 'x' where id = '${COMENTARIO_BETO}'`))).toBe(0)
  })

  it('(c) cambio_etapa ajeno: ni cambiarle el tipo ni el texto', async () => {
    expect(bloqueado(await como(db, P_ANA, `update public.activity_log set tipo = 'comentario' where id = '${ETAPA_BETO}'`))).toBe('error')
    expect(bloqueado(await como(db, P_ANA, `update public.activity_log set contenido = 'x' where id = '${ETAPA_BETO}'`))).toBe(0)
  })

  it('corrección ajena del mismo workspace: 0 (también en «Ver como»)', async () => {
    expect(bloqueado(await como(db, P_ANA, `update public.activity_log set valor_nuevo = '9' where id = '${CORRECCION_BETO}'`))).toBe(0)
  })

  it('(d) el autor no puede pasarle su evento a otro staff', async () => {
    expect(bloqueado(await como(db, P_ANA, `update public.activity_log set autor_id = '${S_BETO}' where id = '${CORRECCION_ANA}'`))).toBe('error')
  })

  it('(e) el autor no puede cambiar el tipo de su evento', async () => {
    expect(bloqueado(await como(db, P_ANA, `update public.activity_log set tipo = 'comentario' where id = '${CORRECCION_ANA}'`))).toBe('error')
    expect(bloqueado(await como(db, P_ANA, `update public.activity_log set tipo = 'cambio' where id = '${COMENTARIO_ANA}'`))).toBe('error')
  })

  it('columnas fijas: negocio, fecha, campo, mención y workspace no se mueven', async () => {
    for (const set of [
      `entidad_id = gen_random_uuid()`,
      `created_at = now() - interval '1 year'`,
      `campo_modificado = 'otro'`,
      `mencion_id = '${S_BETO}'`,
      `link_url = 'https://x'`,
      `workspace_id = '${WS_OTRO}'`,
    ]) {
      expect(bloqueado(await como(db, P_ANA, `update public.activity_log set ${set} where id = '${CORRECCION_ANA}'`))).toBe('error')
    }
  })

  it('(f) un admin no edita comentarios ajenos (modera borrando)', async () => {
    expect(bloqueado(await como(db, P_ADMIN, `update public.activity_log set contenido = 'moderado' where id = '${COMENTARIO_BETO}'`))).toBe(0)
  })

  it('(g) quien está activo en otro workspace no alcanza su propio evento de este', async () => {
    expect(bloqueado(await como(db, P_FORANEA, `update public.activity_log set valor_nuevo = '9' where id = '${CORRECCION_FORANEA}'`))).toBe(0)
  })

  it('(h) el ataque completo, reescribir y borrar, ya no pasa', async () => {
    expect(bloqueado(await como(db, P_ANA,
      `update public.activity_log set tipo = 'comentario', autor_id = '${S_ANA}' where id = '${ETAPA_BETO}'`,
    ))).toBe('error')
    expect(await como(db, P_ANA, `delete from public.activity_log where id = '${ETAPA_BETO}'`)).toEqual({ filas: 0 })
    const r = await db.query<{ tipo: string; autor_id: string }>(`select tipo, autor_id from public.activity_log where id = '${ETAPA_BETO}'`)
    expect(r.rows[0]).toEqual({ tipo: 'cambio_etapa', autor_id: S_BETO })
  })

  it('anon no actualiza nada', async () => {
    const r = await db.transaction(async (tx) => {
      await tx.exec(`set local role anon`)
      try {
        await tx.exec(`update public.activity_log set contenido = 'x'`)
        return 'paso'
      } catch {
        return 'error'
      }
    })
    expect(r).toBe('error')
  })

  it('service_role (bot, crons, hooks) sigue actualizando cualquier columna', async () => {
    const n = await db.transaction(async (tx) => {
      await tx.exec(`set local role service_role`)
      const r = await tx.query<{ n: number }>(
        `with x as (update public.activity_log set entidad_id = entidad_id, tipo = tipo where id = '${ETAPA_BETO}' returning 1) select count(*)::int n from x`,
      )
      return r.rows[0].n
    })
    expect(n).toBe(1)
  })

  it('el borrado de #944 sigue igual: el autor borra su comentario', async () => {
    expect(await como(db, P_ANA, `delete from public.activity_log where id = '${COMENTARIO_ANA}'`)).toEqual({ filas: 1 })
  })
})
