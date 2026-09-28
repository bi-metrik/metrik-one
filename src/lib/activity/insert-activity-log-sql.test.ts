import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Quién puede ESCRIBIR en `activity_log`, ejecutado de verdad en Postgres en memoria
 * (PGlite) con los ARCHIVOS de migración tal cual (#944, #946 y 20260928140000) y
 * `set role authenticated` + JWT, que es como llega una petición de PostgREST.
 *
 * El hueco que cierra 20260928140000: la política de INSERT que dejó #944 solo miraba el
 * workspace, así que un miembro firmaba entradas a nombre de otro staff, o anónimas, o de
 * tipos que solo escribe el sistema. El caso «control» carga solo #944 y #946 y comprueba
 * que el ataque pasa; si dejara de pasar, el resto de este archivo no probaría nada.
 *
 * Los helpers imitan a los de producción (20260730000010): SECURITY DEFINER, leen
 * `auth.uid()` del claim `sub` del JWT.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const BORRAR = '20260928120000_activity_log_borrar_solo_comentarios.sql'
const EDITAR = '20260928130000_activity_log_update_solo_correccion_propia.sql'
const INSERTAR = '20260928140000_activity_log_insert_autor_y_tipo.sql'

const WS = '00000000-0000-4000-8000-0000000000a1'
const WS_OTRO = '00000000-0000-4000-8000-0000000000a2'
// Personas (profile) y su staff.
const P_ANA = '00000000-0000-4000-8000-00000000b001' // operadora
const P_BETO = '00000000-0000-4000-8000-00000000b002' // operador
const P_DUENA = '00000000-0000-4000-8000-00000000b003' // owner del workspace (no platform_admin)
const P_FORANEA = '00000000-0000-4000-8000-00000000b004' // activa en otro workspace
const P_PA_CON_STAFF = '00000000-0000-4000-8000-00000000b005' // platform_admin con staff en WS
const P_PA_SIN_STAFF = '00000000-0000-4000-8000-00000000b006' // platform_admin, su staff vive en WS_OTRO
const P_INACTIVA = '00000000-0000-4000-8000-00000000b007' // staff inactivo en WS
const S_ANA = '00000000-0000-4000-8000-00000000c001'
const S_BETO = '00000000-0000-4000-8000-00000000c002'
const S_DUENA = '00000000-0000-4000-8000-00000000c003'
const S_FORANEA = '00000000-0000-4000-8000-00000000c004'
const S_PA_CON_STAFF = '00000000-0000-4000-8000-00000000c005'
const S_PA_ORIGEN = '00000000-0000-4000-8000-00000000c006' // en WS_OTRO
const S_INACTIVA = '00000000-0000-4000-8000-00000000c007'

const NEGOCIO = '00000000-0000-4000-8000-0000000000e1'

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
    tipo text not null check (tipo in (
      'comentario','cambio','sistema','cambio_etapa','cambio_estado','cambio_sistema',
      'solicitud_conciliacion','conciliacion_atendida','propuesta_aprobada','stage_auto_transition',
      'platform_admin_enter','platform_admin_exit','drive_health_failed','drive_folder_skipped','drive_folder_failed'
    )),
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

  insert into public.profiles (id, workspace_id, role, platform_admin) values
    ('${P_ANA}', '${WS}', 'operator', false),
    ('${P_BETO}', '${WS}', 'operator', false),
    ('${P_DUENA}', '${WS}', 'owner', false),
    ('${P_FORANEA}', '${WS_OTRO}', 'owner', false),
    ('${P_PA_CON_STAFF}', '${WS}', 'owner', true),
    ('${P_PA_SIN_STAFF}', '${WS}', 'owner', true),
    ('${P_INACTIVA}', '${WS}', 'operator', false);
  insert into public.staff (id, profile_id, workspace_id, is_active) values
    ('${S_ANA}', '${P_ANA}', '${WS}', true),
    ('${S_BETO}', '${P_BETO}', '${WS}', true),
    ('${S_DUENA}', '${P_DUENA}', '${WS}', true),
    ('${S_FORANEA}', '${P_FORANEA}', '${WS_OTRO}', true),
    ('${S_PA_CON_STAFF}', '${P_PA_CON_STAFF}', '${WS}', true),
    ('${S_PA_ORIGEN}', '${P_PA_SIN_STAFF}', '${WS_OTRO}', true),
    ('${S_INACTIVA}', '${P_INACTIVA}', '${WS}', false);
`

async function crearBase(migraciones: string[]): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  for (const m of migraciones) await db.exec(leer(m))
  return db
}

type Resultado = 'ok' | 'rechazo'

/** Inserta como el usuario `profileId` (PostgREST: rol authenticated + JWT). */
async function inserta(
  db: PGlite,
  profileId: string,
  fila: { tipo: string; autor: string | null; ws?: string },
): Promise<Resultado> {
  try {
    await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated`)
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: profileId, role: 'authenticated' })])
      await tx.query(
        `insert into public.activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, contenido)
         values ($1, 'negocio', $2, $3, $4, 'x')`,
        [fila.ws ?? WS, NEGOCIO, fila.tipo, fila.autor],
      )
    })
    return 'ok'
  } catch {
    return 'rechazo'
  }
}

describe('control: solo con #944 y #946 el hueco existe', () => {
  let db: PGlite
  beforeAll(async () => { db = await crearBase([BORRAR, EDITAR]) })
  afterAll(async () => { await db.close() })

  it('una operadora firma un comentario a nombre de otro, uno anónimo y un aviso de MeTRIK', async () => {
    expect(await inserta(db, P_ANA, { tipo: 'comentario', autor: S_BETO })).toBe('ok')
    expect(await inserta(db, P_ANA, { tipo: 'cambio_etapa', autor: null })).toBe('ok')
    expect(await inserta(db, P_ANA, { tipo: 'platform_admin_enter', autor: null })).toBe('ok')
  })
})

describe('20260928140000: INSERT firmado por uno mismo y con tipos de sesión', () => {
  let db: PGlite
  beforeAll(async () => { db = await crearBase([BORRAR, EDITAR, INSERTAR]) })
  afterAll(async () => { await db.close() })

  it('una operadora comenta con su propio staff (addComment)', async () => {
    expect(await inserta(db, P_ANA, { tipo: 'comentario', autor: S_ANA })).toBe('ok')
  })

  it('comentario con el autor de otro staff: rechazo', async () => {
    expect(await inserta(db, P_ANA, { tipo: 'comentario', autor: S_BETO })).toBe('rechazo')
  })

  it('una owner que no es platform_admin tampoco firma por otro', async () => {
    expect(await inserta(db, P_DUENA, { tipo: 'comentario', autor: S_ANA })).toBe('rechazo')
  })

  it('autor de otro workspace: rechazo', async () => {
    expect(await inserta(db, P_ANA, { tipo: 'comentario', autor: S_FORANEA })).toBe('rechazo')
  })

  it('anónimo quien SÍ tiene staff en el workspace: rechazo (un cambio_etapa «del sistema» falso)', async () => {
    expect(await inserta(db, P_ANA, { tipo: 'cambio_etapa', autor: null })).toBe('rechazo')
    expect(await inserta(db, P_ANA, { tipo: 'comentario', autor: null })).toBe('rechazo')
  })

  it('tipos que solo escribe el sistema: rechazo aunque el autor sea el propio', async () => {
    for (const tipo of [
      'platform_admin_enter', 'platform_admin_exit', 'drive_health_failed',
      'stage_auto_transition', 'solicitud_conciliacion', 'conciliacion_atendida',
    ]) {
      expect(await inserta(db, P_ANA, { tipo, autor: S_ANA })).toBe('rechazo')
      expect(await inserta(db, P_ANA, { tipo, autor: null })).toBe('rechazo')
    }
  })

  it('otro workspace: rechazo (ni con su propio staff)', async () => {
    expect(await inserta(db, P_ANA, { tipo: 'comentario', autor: S_ANA, ws: WS_OTRO })).toBe('rechazo')
  })

  it('cada tipo que la app escribe con sesión, firmado por el propio staff: ok', async () => {
    for (const tipo of [
      'comentario', 'cambio', 'sistema', 'cambio_etapa', 'cambio_estado', 'cambio_sistema', 'propuesta_aprobada',
    ]) {
      expect(await inserta(db, P_ANA, { tipo, autor: S_ANA })).toBe('ok')
    }
  })

  it('notas de carpeta de Drive sin autor (ensureNegocioDriveFolder desde crearNegocio): ok', async () => {
    expect(await inserta(db, P_ANA, { tipo: 'drive_folder_skipped', autor: null })).toBe('ok')
    expect(await inserta(db, P_ANA, { tipo: 'drive_folder_failed', autor: null })).toBe('ok')
  })

  it('staff inactivo del mismo workspace firma como él (getWorkspace lo resuelve igual)', async () => {
    expect(await inserta(db, P_INACTIVA, { tipo: 'comentario', autor: S_INACTIVA })).toBe('ok')
  })

  it('platform_admin sin staff en el workspace escribe sin autor (staffId null de getWorkspace)', async () => {
    expect(await inserta(db, P_PA_SIN_STAFF, { tipo: 'cambio', autor: null })).toBe('ok')
    // ...pero no presta su staff de origen: sería autoría cross-tenant.
    expect(await inserta(db, P_PA_SIN_STAFF, { tipo: 'cambio', autor: S_PA_ORIGEN })).toBe('rechazo')
  })

  it('«Ver como»: platform_admin firma con el staff del impersonado del mismo workspace', async () => {
    expect(await inserta(db, P_PA_CON_STAFF, { tipo: 'cambio', autor: S_BETO })).toBe('ok')
    expect(await inserta(db, P_PA_SIN_STAFF, { tipo: 'comentario', autor: S_ANA })).toBe('ok')
    expect(await inserta(db, P_PA_CON_STAFF, { tipo: 'cambio', autor: S_PA_CON_STAFF })).toBe('ok')
    // Ni en «Ver como» se firma con un staff de otro workspace, ni con tipos del sistema.
    expect(await inserta(db, P_PA_CON_STAFF, { tipo: 'cambio', autor: S_FORANEA })).toBe('rechazo')
    expect(await inserta(db, P_PA_CON_STAFF, { tipo: 'platform_admin_enter', autor: null })).toBe('rechazo')
  })

  it('anon no inserta nada', async () => {
    const r = await db.transaction(async (tx) => {
      await tx.exec(`set local role anon`)
      try {
        await tx.exec(
          `insert into public.activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id)
           values ('${WS}', 'negocio', '${NEGOCIO}', 'comentario', null)`,
        )
        return 'paso'
      } catch {
        return 'error'
      }
    })
    expect(r).toBe('error')
  })

  it('service_role (crons, webhooks, bot, entrada de platform_admin) sigue escribiendo cualquier cosa', async () => {
    const n = await db.transaction(async (tx) => {
      await tx.exec(`set local role service_role`)
      const r = await tx.query<{ n: number }>(
        `with x as (
           insert into public.activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id)
           values ('${WS}', 'workspace', '${WS}', 'platform_admin_enter', null),
                  ('${WS}', 'negocio', '${NEGOCIO}', 'comentario', '${S_BETO}')
           returning 1) select count(*)::int n from x`,
      )
      return r.rows[0].n
    })
    expect(n).toBe(2)
  })

  it('las políticas de SELECT, UPDATE y DELETE siguen siendo las de #944 y #946', async () => {
    const r = await db.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies where tablename = 'activity_log' order by cmd, policyname`,
    )
    expect(r.rows).toEqual([
      { policyname: 'activity_log_delete_comentario', cmd: 'DELETE' },
      { policyname: 'activity_log_insert_propio', cmd: 'INSERT' },
      { policyname: 'activity_log_select_workspace', cmd: 'SELECT' },
      { policyname: 'activity_log_update_correccion_propia', cmd: 'UPDATE' },
    ])
  })
})
