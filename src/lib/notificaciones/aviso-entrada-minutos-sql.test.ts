import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Una entrada REPETIDA a la misma etapa en minutos no vuelve a avisar.
 *
 * Medido el 2026-10-06: 183 pares `negocio_en_etapa` (51 en 30 días) a ~68 s uno del otro. El
 * trigger cuelga de cada cambio de `etapa_actual_id`: si el caso va y vuelve a la misma etapa,
 * avisa dos veces a la campana y, si la etapa lo declara, dos veces al cliente por `notificar-etapa`.
 *
 * Se arma la función VIVA como la dejaron las migraciones (20260825000001 + el reemplazo de
 * 20260902000004) y encima se aplica la de hoy, que la parcha por ancla igual que esa.
 */

const MIG = (n: string) => readFileSync(join(process.cwd(), 'supabase/migrations', n), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'
const NEG = '00000000-0000-4000-8000-0000000000b1'
const LINEA = '00000000-0000-4000-8000-0000000000c0'
const ET_A = '00000000-0000-4000-8000-0000000000c1'
const ET_X = '00000000-0000-4000-8000-0000000000c2'
const ET_Y = '00000000-0000-4000-8000-0000000000c3'
const PERFIL = '00000000-0000-4000-8000-0000000000d1'

const ESQUEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  insert into vault.decrypted_secrets values ('NOTIFICAR_ETAPA_SECRET', 's'), ('SUPABASE_FUNCTIONS_URL', 'https://f');
  create schema net;
  create table net.llamadas (url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb) returns bigint
    language sql as $$ insert into net.llamadas values (url, body, headers) returning 1::bigint $$;

  create table public.workspaces (id uuid primary key);
  create table public.etapas_negocio (id uuid primary key, linea_id uuid, nombre text, config_extra jsonb default '{}'::jsonb);
  create table public.negocios (
    id uuid primary key, workspace_id uuid, nombre text, codigo text,
    estado text default 'abierto', etapa_actual_id uuid
  );
  create table public.bloque_configs (id uuid primary key, slug text);
  create table public.negocio_bloques (id uuid primary key, negocio_id uuid, bloque_config_id uuid, estado text);
  create table public.notificaciones (
    id uuid primary key default gen_random_uuid(), workspace_id uuid, destinatario_id uuid,
    tipo text, contenido text, entidad_tipo text, entidad_id uuid, deep_link text,
    metadata jsonb, estado text default 'pendiente', created_at timestamptz default now()
  );
  create table public.avisos_cliente (
    id uuid primary key default gen_random_uuid(), negocio_id uuid, etapa_id uuid,
    bloque_config_id uuid, canal text, estado text, created_at timestamptz default now()
  );
  create function public.destinatarios_negocio(p uuid) returns table (profile_id uuid, via text)
    language sql as $$ select '${PERFIL}'::uuid, 'responsable_comercial'::text $$;
  create function public.crear_notificacion(
    p_workspace_id uuid, p_destinatario_id uuid, p_tipo text, p_contenido text,
    p_entidad_tipo text default null, p_entidad_id uuid default null, p_deep_link text default null,
    p_metadata jsonb default '{}'::jsonb, p_permitir_repetidas boolean default false)
  returns uuid language plpgsql as $f$
  declare v uuid;
  begin
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
    insert into notificaciones (workspace_id, tipo, contenido, entidad_id, metadata)
    values (p_workspace_id, p_tipo, p_contenido, p_entidad_id, p_metadata);
    return 1;
  end $f$;

  insert into public.workspaces values ('${WS}');
  -- X avisa al equipo y al cliente; A y Y no avisan.
  insert into public.etapas_negocio values
    ('${ET_A}', '${LINEA}', 'Validacion', '{}'),
    ('${ET_X}', '${LINEA}', 'Cita', '{"avisar_al_entrar": {"email": true}, "avisar_al_cliente": {"whatsapp": true}}'),
    ('${ET_Y}', '${LINEA}', 'Anexos', '{}');
  insert into public.negocios (id, workspace_id, nombre, codigo, etapa_actual_id) values ('${NEG}', '${WS}', 'Caso', 'V1', '${ET_A}');
`

/** El primer bloque `do $$ ... end $$;` de 20260902000004: estampa `etapa_id` en el aviso. */
function estampaEtapaId(): string {
  const sql = MIG('20260902000004_aviso_de_entrada_que_quedo_atras.sql')
  const m = sql.match(/do \$\$[\s\S]*?end \$\$;/)
  if (!m) throw new Error('no se encontró el bloque de 20260902000004')
  return m[0]
}

function trigger(): string {
  const sql = MIG('20260728000003_aviso_entrada_etapa.sql')
  const m = sql.match(/create trigger trg_avisar_entrada_etapa[\s\S]*?avisar_entrada_etapa\(\);/)
  if (!m) throw new Error('no se encontró el trigger')
  return m[0]
}

let db: PGlite

async function armar(conGuarda: boolean) {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(MIG('20260825000001_aviso_entrada_no_se_repite.sql'))
  await db.exec(estampaEtapaId())
  await db.exec(trigger())
  if (conGuarda) await db.exec(MIG('20261006150100_aviso_entrada_no_se_repite_en_minutos.sql'))
}

const mover = (etapa: string) => db.query(`update negocios set etapa_actual_id = $1 where id = $2`, [etapa, NEG])
const avisosEquipo = async () =>
  (await db.query<{ n: number }>(`select count(*)::int as n from notificaciones where tipo = 'negocio_en_etapa'`)).rows[0].n
const llamadasAlCliente = async () =>
  (await db.query<{ n: number }>(`select count(*)::int as n from net.llamadas`)).rows[0].n

afterEach(async () => {
  await db.close()
})

describe('ANTES (sin la guarda)', () => {
  beforeEach(() => armar(false))
  it('ir y volver a la misma etapa avisaba dos veces al equipo y llamaba dos veces a notificar-etapa', async () => {
    await mover(ET_X)
    await mover(ET_Y)
    await mover(ET_X)
    expect(await avisosEquipo()).toBe(2)
    expect(await llamadasAlCliente()).toBe(2)
  })
})

describe('AHORA (con la guarda)', () => {
  beforeEach(() => armar(true))

  it('ir y volver a la misma etapa en minutos avisa UNA vez, al equipo y al cliente', async () => {
    await mover(ET_X)
    await mover(ET_Y)
    await mover(ET_X)
    expect(await avisosEquipo()).toBe(1)
    expect(await llamadasAlCliente()).toBe(1)
  })

  it('una re-entrada pasados 10 minutos sí vuelve a avisar', async () => {
    await mover(ET_X)
    await mover(ET_Y)
    await db.query(`update notificaciones set created_at = now() - interval '11 minutes'`)
    await mover(ET_X)
    expect(await avisosEquipo()).toBe(2)
    expect(await llamadasAlCliente()).toBe(2)
  })

  it('una etapa que solo avisa al cliente se protege por la traza de avisos_cliente', async () => {
    await db.query(`update etapas_negocio set config_extra = '{"avisar_al_cliente": {"email": true}}' where id = $1`, [ET_X])
    await mover(ET_X)
    // La traza la escribe notificar-etapa después del disparo; aquí se simula.
    await db.query(`insert into avisos_cliente (negocio_id, etapa_id, canal, estado) values ($1, $2, 'email', 'enviado')`, [NEG, ET_X])
    await mover(ET_Y)
    await mover(ET_X)
    expect(await llamadasAlCliente()).toBe(1)
  })

  it('la migración es idempotente y la función sigue sin ejecutarse por anon', async () => {
    await db.exec(MIG('20261006150100_aviso_entrada_no_se_repite_en_minutos.sql'))
    const { rows } = await db.query<{ n: number }>(
      `select (length(prosrc) - length(replace(prosrc, 'Doble guardado (2026-10-06)', ''))) / length('Doble guardado (2026-10-06)') as n
       from pg_proc where proname = 'avisar_entrada_etapa'`)
    expect(Number(rows[0].n)).toBe(1)
    const { rows: p } = await db.query<{ anon: boolean }>(
      `select has_function_privilege('anon', 'public.avisar_entrada_etapa()', 'execute') as anon`)
    expect(p[0].anon).toBe(false)
  })
})
