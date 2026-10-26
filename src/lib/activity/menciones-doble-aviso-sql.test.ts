import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Por qué una mención avisaba DOS veces (medido el 2026-10-06: 72 pares `mencion` con 0,2 s
 * entre uno y otro).
 *
 * `addComment` escribe en dos viajes: primero la fila de `activity_log` con `mencion_id` (la
 * primera persona mencionada, para el distintivo del timeline) y después las filas de
 * `activity_menciones`. Cada viaje dispara su trigger:
 *
 *   1. `trg_notif_mencion` (AFTER INSERT en activity_log, si `mencion_id` no es null). Su guarda
 *      pregunta si el comentario ya tiene filas en `activity_menciones`… y todavía no las tiene:
 *      llegan en el viaje siguiente. Avisa.
 *   2. `trg_notif_mencion_multiple` (AFTER INSERT en activity_menciones). Avisa otra vez.
 *
 * La guarda de la migración 20260727000005 solo funcionaría si las dos escrituras fueran una
 * misma transacción en el orden inverso. Aquí se corren los triggers REALES de las migraciones.
 */

const MIG = (n: string) => readFileSync(join(process.cwd(), 'supabase/migrations', n), 'utf8')

const WS = '00000000-0000-4000-8000-00000000000a'
const NEG = '00000000-0000-4000-8000-0000000000b1'
const P_AUTORA = '00000000-0000-4000-8000-0000000000c1'
const P_BETO = '00000000-0000-4000-8000-0000000000c2'
const P_CARLA = '00000000-0000-4000-8000-0000000000c3'
const S_AUTORA = '00000000-0000-4000-8000-0000000000d1'
const S_BETO = '00000000-0000-4000-8000-0000000000d2'
const S_CARLA = '00000000-0000-4000-8000-0000000000d3'

const ESQUEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create table public.workspaces (id uuid primary key);
  create table public.profiles (id uuid primary key, workspace_id uuid);
  create table public.staff (id uuid primary key, profile_id uuid, workspace_id uuid, full_name text);
  create table public.negocios (id uuid primary key, nombre text);
  create table public.oportunidades (id uuid primary key, descripcion text);
  create table public.proyectos (id uuid primary key, nombre text);
  create function public.current_user_workspace_id() returns uuid language sql stable as $$ select '${WS}'::uuid $$;
  create table public.activity_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, entidad_tipo text not null, entidad_id uuid not null,
    tipo text not null, autor_id uuid, contenido text, mencion_id uuid,
    created_at timestamptz default now()
  );
  create table public.notificaciones (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid, destinatario_id uuid, tipo text, contenido text,
    entidad_tipo text, entidad_id uuid, deep_link text, metadata jsonb,
    estado text default 'pendiente', grupo_clave text
  );
  -- La firma viva de crear_notificacion (sin la guarda de sesión, que aquí no aplica).
  create function public.crear_notificacion(
    p_workspace_id uuid, p_destinatario_id uuid, p_tipo text, p_contenido text,
    p_entidad_tipo text default null, p_entidad_id uuid default null,
    p_deep_link text default null, p_metadata jsonb default '{}'::jsonb,
    p_permitir_repetidas boolean default false)
  returns uuid language plpgsql as $f$
  declare v uuid;
  begin
    if not p_permitir_repetidas and exists (select 1 from notificaciones
      where destinatario_id = p_destinatario_id and tipo = p_tipo
        and entidad_id is not distinct from p_entidad_id and estado = 'pendiente') then
      return null;
    end if;
    insert into notificaciones (workspace_id, destinatario_id, tipo, contenido, entidad_tipo, entidad_id, deep_link, metadata)
    values (p_workspace_id, p_destinatario_id, p_tipo, p_contenido, p_entidad_tipo, p_entidad_id, p_deep_link, p_metadata)
    returning id into v;
    return v;
  end $f$;
  create function public.crear_notificacion_equipo(
    p_workspace_id uuid, p_area text, p_tipo text, p_contenido text, p_grupo_clave text,
    p_entidad_tipo text default null, p_entidad_id uuid default null, p_deep_link text default null,
    p_metadata jsonb default '{}'::jsonb, p_excluir_profile_id uuid default null)
  returns integer language plpgsql as $f$
  begin
    insert into notificaciones (workspace_id, tipo, contenido, grupo_clave, entidad_id)
    values (p_workspace_id, p_tipo, p_contenido, p_grupo_clave, p_entidad_id);
    return 1;
  end $f$;
  insert into public.workspaces values ('${WS}');
  insert into public.negocios values ('${NEG}', 'V0001');
  insert into public.staff values
    ('${S_AUTORA}', '${P_AUTORA}', '${WS}', 'Autora'),
    ('${S_BETO}', '${P_BETO}', '${WS}', 'Beto'),
    ('${S_CARLA}', '${P_CARLA}', '${WS}', 'Carla');
`

/** El trigger legado, tal cual lo creó 20260323000000 (la función viva es la de 000005). */
function triggerLegado(): string {
  const sql = MIG('20260323000000_notificaciones_sistema.sql')
  const m = sql.match(/CREATE TRIGGER trg_notif_mencion\s[\s\S]*?EXECUTE FUNCTION fn_notif_mencion\(\);/)
  if (!m) throw new Error('no se encontró trg_notif_mencion en 20260323000000')
  return m[0]
}

let db: PGlite

beforeEach(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(MIG('20260727000005_menciones_multiples_y_equipo.sql'))
  await db.exec(triggerLegado())
})

afterEach(async () => {
  await db.close()
})

/** Los dos viajes de `addComment`, en el orden en que los hace. */
async function comentar(mencionId: string | null, staffIds: string[]): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `insert into activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, contenido, mencion_id)
     values ($1, 'negocio', $2, 'comentario', $3, 'hola', $4) returning id`,
    [WS, NEG, S_AUTORA, mencionId],
  )
  for (const sid of staffIds) {
    await db.query(
      `insert into activity_menciones (workspace_id, activity_log_id, staff_id) values ($1, $2, $3)`,
      [WS, rows[0].id, sid],
    )
  }
}

async function avisosA(profileId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from notificaciones where tipo = 'mencion' and destinatario_id = $1`,
    [profileId],
  )
  return rows[0].n
}

describe('mención en un comentario', () => {
  it('ANTES: con mencion_id puesto, la primera persona recibía DOS avisos', async () => {
    await comentar(S_BETO, [S_BETO, S_CARLA])
    expect(await avisosA(P_BETO)).toBe(2)
    expect(await avisosA(P_CARLA)).toBe(1)
  })

  it('AHORA: sin mencion_id cuando hay menciones nuevas, cada persona recibe UNO', async () => {
    await comentar(null, [S_BETO, S_CARLA])
    expect(await avisosA(P_BETO)).toBe(1)
    expect(await avisosA(P_CARLA)).toBe(1)
  })

  it('el camino legado (solo mencion_id, sin filas nuevas) sigue avisando una vez', async () => {
    await comentar(S_BETO, [])
    expect(await avisosA(P_BETO)).toBe(1)
  })
})
