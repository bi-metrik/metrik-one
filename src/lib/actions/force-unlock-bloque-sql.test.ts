import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * `force_unlock_bloque` ejecutado de verdad en Postgres en memoria (PGlite), con los
 * ARCHIVOS de migración tal cual y `set role authenticated` + JWT, que es como llega un
 * `rpc()` de PostgREST.
 *
 * El hueco que cierra 20260928150000: la función (SECURITY DEFINER, sin RLS) insertaba la
 * entrada de la Actividad con `autor_id = p_forced_by` sin validarlo, así que una owner
 * firmaba el desbloqueo a nombre de otro staff, incluso de otro workspace. El caso
 * «control» carga la definición anterior (20260901000002, recortada del archivo) y
 * comprueba que el ataque pasa; si dejara de pasar, el resto no probaría nada.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const BORRAR = '20260928120000_activity_log_borrar_solo_comentarios.sql'
const EDITAR = '20260928130000_activity_log_update_solo_correccion_propia.sql'
const INSERTAR = '20260928140000_activity_log_insert_autor_y_tipo.sql'
const FORZAR = '20260928150000_force_unlock_bloque_autor_de_sesion.sql'

/**
 * De 20260901000002 solo interesan la guarda de workspace y la versión anterior de
 * `force_unlock_bloque` (el resto del archivo envuelve funciones que aquí no existen).
 * Se recortan del archivo, no se copian: así el control es la definición real.
 */
function versionAnterior(): string {
  const f = leer('20260901000002_guarda_workspace_rpc_con_sesion.sql')
  const tramo = (desde: string, hasta: string) => {
    const i = f.indexOf(desde)
    const j = f.indexOf(hasta, i)
    if (i < 0 || j < 0) throw new Error(`no se encontró el tramo ${desde}`)
    return f.slice(i, j + hasta.length)
  }
  return [
    tramo(
      'create or replace function public.assert_workspace_del_usuario',
      'revoke execute on function public.assert_workspace_del_usuario(uuid) from public, anon, authenticated;',
    ),
    tramo('create or replace function public.force_unlock_bloque', '$fn$;'),
    tramo(
      'revoke execute on function public.force_unlock_bloque(uuid, uuid) from public, anon;',
      'grant  execute on function public.force_unlock_bloque(uuid, uuid) to authenticated, service_role;',
    ),
  ].join('\n\n')
}

const WS = '00000000-0000-4000-8000-0000000000a1'
const WS_OTRO = '00000000-0000-4000-8000-0000000000a2'
const P_ANA = '00000000-0000-4000-8000-00000000b001' // operadora
const P_BETO = '00000000-0000-4000-8000-00000000b002' // operador
const P_DUENA = '00000000-0000-4000-8000-00000000b003' // owner
const P_FORANEA = '00000000-0000-4000-8000-00000000b004' // owner de otro workspace
const P_PA_CON_STAFF = '00000000-0000-4000-8000-00000000b005' // platform_admin con staff en WS
const P_PA_SIN_STAFF = '00000000-0000-4000-8000-00000000b006' // platform_admin, su staff vive en WS_OTRO
const P_ADMIN = '00000000-0000-4000-8000-00000000b008' // admin
const S_ANA = '00000000-0000-4000-8000-00000000c001'
const S_BETO = '00000000-0000-4000-8000-00000000c002'
const S_DUENA = '00000000-0000-4000-8000-00000000c003'
const S_FORANEA = '00000000-0000-4000-8000-00000000c004'
const S_PA_CON_STAFF = '00000000-0000-4000-8000-00000000c005'
const S_PA_ORIGEN = '00000000-0000-4000-8000-00000000c006'
const S_ADMIN = '00000000-0000-4000-8000-00000000c008'

const NEGOCIO = '00000000-0000-4000-8000-0000000000e1'
const BLOQUE = '00000000-0000-4000-8000-0000000000f1'
const BLOQUE_SIN_LOCK = '00000000-0000-4000-8000-0000000000f2'

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

  create table public.profiles (id uuid primary key, workspace_id uuid, role text, platform_admin boolean not null default false);
  create table public.staff (id uuid primary key, profile_id uuid unique, workspace_id uuid, is_active boolean default true);

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
    tipo text not null,
    autor_id uuid references public.staff(id),
    campo_modificado text,
    valor_anterior text,
    valor_nuevo text,
    contenido text,
    mencion_id uuid,
    link_url text,
    created_at timestamptz default now()
  );
  grant all on public.activity_log to anon, authenticated, service_role;
  alter table public.activity_log enable row level security;
  create policy activity_log_workspace_isolation on public.activity_log
    for all using (workspace_id = (select public.current_user_workspace_id()));

  create table public.negocio_bloques (id uuid primary key, negocio_id uuid);
  create table public.bloque_locks (
    bloque_instancia_id uuid primary key,
    locked_by uuid,
    locked_at timestamptz default now(),
    expires_at timestamptz default now() + interval '5 minutes',
    workspace_id uuid
  );
  grant all on public.bloque_locks to anon, authenticated, service_role;
  alter table public.bloque_locks enable row level security;

  insert into public.profiles (id, workspace_id, role, platform_admin) values
    ('${P_ANA}', '${WS}', 'operator', false),
    ('${P_BETO}', '${WS}', 'operator', false),
    ('${P_DUENA}', '${WS}', 'owner', false),
    ('${P_FORANEA}', '${WS_OTRO}', 'owner', false),
    ('${P_PA_CON_STAFF}', '${WS}', 'operator', true),
    ('${P_PA_SIN_STAFF}', '${WS}', 'operator', true),
    ('${P_ADMIN}', '${WS}', 'admin', false);
  insert into public.staff (id, profile_id, workspace_id, is_active) values
    ('${S_ANA}', '${P_ANA}', '${WS}', true),
    ('${S_BETO}', '${P_BETO}', '${WS}', true),
    ('${S_DUENA}', '${P_DUENA}', '${WS}', true),
    ('${S_FORANEA}', '${P_FORANEA}', '${WS_OTRO}', true),
    ('${S_PA_CON_STAFF}', '${P_PA_CON_STAFF}', '${WS}', true),
    ('${S_PA_ORIGEN}', '${P_PA_SIN_STAFF}', '${WS_OTRO}', true),
    ('${S_ADMIN}', '${P_ADMIN}', '${WS}', true);
  insert into public.negocio_bloques (id, negocio_id) values ('${BLOQUE}', '${NEGOCIO}'), ('${BLOQUE_SIN_LOCK}', '${NEGOCIO}');
`

async function crearBase(conNueva: boolean): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  for (const m of [BORRAR, EDITAR, INSERTAR]) await db.exec(leer(m))
  await db.exec(versionAnterior())
  if (conNueva) await db.exec(leer(FORZAR))
  return db
}

type Resultado =
  | { r: 'ok'; autor: string | null; lockBorrado: boolean; entradas: number }
  | { r: 'forbidden' | 'not_found'; lockBorrado: boolean; entradas: number }
  | { r: 'error'; lockBorrado: boolean; entradas: number }

/**
 * Pone un lock de Beto sobre el bloque, llama la RPC como `quien` y devuelve qué pasó:
 * la respuesta, el autor de la entrada que dejó, si soltó el lock y cuántas entradas
 * nuevas hubo. `quien`: un profile (authenticated + JWT), 'anon' o 'service_role'.
 */
async function forzar(db: PGlite, quien: string, forcedBy: string | null, bloque = BLOQUE): Promise<Resultado> {
  await db.exec(`delete from public.activity_log; delete from public.bloque_locks;
    insert into public.bloque_locks (bloque_instancia_id, locked_by, workspace_id) values ('${BLOQUE}', '${P_BETO}', '${WS}');`)
  let respuesta: string
  try {
    respuesta = await db.transaction(async (tx) => {
      if (quien === 'anon' || quien === 'service_role') {
        await tx.exec(`set local role ${quien}`)
        // Sin `sub`: auth.uid() es null, como en PostgREST con esas llaves.
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: quien })])
      } else {
        await tx.exec(`set local role authenticated`)
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: quien, role: 'authenticated' }),
        ])
      }
      const q = await tx.query<{ r: { ok: boolean; error?: string } }>(
        `select public.force_unlock_bloque($1, $2) as r`,
        [bloque, forcedBy],
      )
      const r = q.rows[0].r
      return r.ok ? 'ok' : (r.error as string)
    })
  } catch {
    respuesta = 'error'
  }
  const lock = await db.query(`select 1 from public.bloque_locks where bloque_instancia_id = '${BLOQUE}'`)
  const log = await db.query<{ autor_id: string | null; tipo: string; contenido: string; entidad_tipo: string; entidad_id: string; workspace_id: string }>(
    `select autor_id, tipo, contenido, entidad_tipo, entidad_id, workspace_id from public.activity_log`,
  )
  const base = { lockBorrado: lock.rows.length === 0, entradas: log.rows.length }
  if (respuesta === 'ok') {
    const e = log.rows[0]
    if (e) {
      // Lo que registra no cambia: misma entidad, tipo y texto.
      expect(e).toMatchObject({
        tipo: 'sistema', entidad_tipo: 'negocio', entidad_id: NEGOCIO, workspace_id: WS,
        contenido: 'Edicion de bloque forzada por owner/admin',
      })
    }
    return { r: 'ok', autor: e ? e.autor_id : null, ...base }
  }
  if (respuesta === 'forbidden' || respuesta === 'not_found') return { r: respuesta, ...base }
  return { r: 'error', ...base }
}

describe('control: con la definición anterior (20260901000002) el hueco existe', () => {
  let db: PGlite
  beforeAll(async () => { db = await crearBase(false) })
  afterAll(async () => { await db.close() })

  it('una owner firma el desbloqueo a nombre de otro staff, incluso de otro workspace', async () => {
    expect(await forzar(db, P_DUENA, S_ANA)).toMatchObject({ r: 'ok', autor: S_ANA })
    expect(await forzar(db, P_DUENA, S_FORANEA)).toMatchObject({ r: 'ok', autor: S_FORANEA })
  })

  it('lo que pasaba la app (el profile id) rompía la FK y el desbloqueo se revertía', async () => {
    expect(await forzar(db, P_DUENA, P_DUENA)).toMatchObject({ r: 'error', lockBorrado: false, entradas: 0 })
  })
})

describe('20260928150000: el autor sale de la sesión', () => {
  let db: PGlite
  beforeAll(async () => { db = await crearBase(true) })
  afterAll(async () => { await db.close() })

  it('owner fuerza: suelta el lock y firma con su propio staff aunque pase otro', async () => {
    expect(await forzar(db, P_DUENA, S_ANA)).toEqual({ r: 'ok', autor: S_DUENA, lockBorrado: true, entradas: 1 })
    expect(await forzar(db, P_DUENA, S_FORANEA)).toEqual({ r: 'ok', autor: S_DUENA, lockBorrado: true, entradas: 1 })
    expect(await forzar(db, P_DUENA, S_PA_CON_STAFF)).toEqual({ r: 'ok', autor: S_DUENA, lockBorrado: true, entradas: 1 })
    expect(await forzar(db, P_DUENA, null)).toEqual({ r: 'ok', autor: S_DUENA, lockBorrado: true, entradas: 1 })
    expect(await forzar(db, P_DUENA, S_DUENA)).toEqual({ r: 'ok', autor: S_DUENA, lockBorrado: true, entradas: 1 })
  })

  it('admin fuerza: igual, con su propio staff', async () => {
    expect(await forzar(db, P_ADMIN, S_BETO)).toEqual({ r: 'ok', autor: S_ADMIN, lockBorrado: true, entradas: 1 })
  })

  it('lo que pasaba antes la app (un profile id, no un staff) ya no rompe: firma el staff propio', async () => {
    expect(await forzar(db, P_DUENA, P_DUENA)).toEqual({ r: 'ok', autor: S_DUENA, lockBorrado: true, entradas: 1 })
  })

  it('miembro sin rol owner/admin: forbidden, el lock sigue y no se registra nada (como antes)', async () => {
    expect(await forzar(db, P_ANA, S_ANA)).toEqual({ r: 'forbidden', lockBorrado: false, entradas: 0 })
  })

  it('owner de otro workspace: rechazo por la guarda de workspace', async () => {
    expect(await forzar(db, P_FORANEA, S_FORANEA)).toEqual({ r: 'error', lockBorrado: false, entradas: 0 })
  })

  it('anon: error de permiso', async () => {
    expect(await forzar(db, 'anon', S_BETO)).toEqual({ r: 'error', lockBorrado: false, entradas: 0 })
  })

  it('bloque sin lock: not_found (como antes)', async () => {
    expect(await forzar(db, P_DUENA, S_DUENA, BLOQUE_SIN_LOCK)).toMatchObject({ r: 'not_found', entradas: 0 })
  })

  it('«Ver como»: platform_admin firma con el staff del impersonado de ESE workspace', async () => {
    expect(await forzar(db, P_PA_CON_STAFF, S_BETO)).toEqual({ r: 'ok', autor: S_BETO, lockBorrado: true, entradas: 1 })
    expect(await forzar(db, P_PA_SIN_STAFF, S_ANA)).toEqual({ r: 'ok', autor: S_ANA, lockBorrado: true, entradas: 1 })
  })

  it('platform_admin con un staff de otro workspace: se ignora (el propio, o null si no tiene staff ahí)', async () => {
    expect(await forzar(db, P_PA_CON_STAFF, S_FORANEA)).toEqual({ r: 'ok', autor: S_PA_CON_STAFF, lockBorrado: true, entradas: 1 })
    expect(await forzar(db, P_PA_SIN_STAFF, S_PA_ORIGEN)).toEqual({ r: 'ok', autor: null, lockBorrado: true, entradas: 1 })
    expect(await forzar(db, P_PA_SIN_STAFF, null)).toEqual({ r: 'ok', autor: null, lockBorrado: true, entradas: 1 })
  })

  it('service_role (hoy sin llamadores): p_forced_by solo si es staff del workspace del bloque', async () => {
    expect(await forzar(db, 'service_role', S_BETO)).toEqual({ r: 'ok', autor: S_BETO, lockBorrado: true, entradas: 1 })
    expect(await forzar(db, 'service_role', S_FORANEA)).toEqual({ r: 'ok', autor: null, lockBorrado: true, entradas: 1 })
  })

  it('una sola firma, SECURITY DEFINER con search_path fijo, sin EXECUTE para public ni anon', async () => {
    const r = await db.query<{ args: string; secdef: boolean; config: string[]; anon: boolean; pub: boolean; auth: boolean }>(
      `select pg_get_function_identity_arguments(p.oid) args, p.prosecdef secdef, p.proconfig config,
              has_function_privilege('anon', p.oid, 'execute') anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') pub,
              has_function_privilege('authenticated', p.oid, 'execute') auth
       from pg_proc p where p.proname = 'force_unlock_bloque'`,
    )
    expect(r.rows).toEqual([{
      args: 'p_bloque_instancia_id uuid, p_forced_by uuid', secdef: true,
      config: ['search_path=public, pg_temp'], anon: false, pub: false, auth: true,
    }])
  })
})
