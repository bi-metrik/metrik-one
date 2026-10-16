/**
 * `20261016193000_aviso_asignacion_responsable.sql` corrida de verdad en Postgres en memoria (PGlite).
 *
 * El aviso a la persona asignada sale de un trigger sobre `negocio_responsables`, así que cubre todos los caminos
 * (el bot, la pantalla, la automática por etapa, un script). Lo que se prueba:
 *   · con el workspace encendido, una fila NUEVA crea la campanita y llama a `avisar-asignacion` por pg_net;
 *   · quien se asigna a sí misma no recibe aviso; el sistema (assigned_by nulo) sí avisa;
 *   · sin la clave del workspace, inactivo, sin perfil o negocio cerrado: nada;
 *   · reasignar a la misma persona (UPDATE por el upsert) no avisa, ni quitar y volver a poner en minutos;
 *   · un fallo del aviso no tumba la asignación;
 *   · el texto de la campanita es el mismo del correo (`_shared/aviso-asignacion.ts`).
 * `crear_notificacion`, el vault y `net.http_post` son dobles mínimos: lo que se prueba es la migración.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { textoAvisoAsignacion } from '../../../supabase/functions/_shared/aviso-asignacion.ts'

const MIGRACION = readFileSync(join(process.cwd(), 'supabase/migrations/20261016193000_aviso_asignacion_responsable.sql'), 'utf8')

const WS = '00000000-0000-4000-8000-00000000f001'
const WS_APAGADO = '00000000-0000-4000-8000-00000000f002'
const NEG = '00000000-0000-4000-8000-00000000f010'
const NEG_CERRADO = '00000000-0000-4000-8000-00000000f011'
const NEG_APAGADO = '00000000-0000-4000-8000-00000000f012'
const EDGAR = '00000000-0000-4000-8000-00000000f020'
const EDGAR_P = '00000000-0000-4000-8000-00000000f021'
const TATI = '00000000-0000-4000-8000-00000000f030'
const TATI_P = '00000000-0000-4000-8000-00000000f031'
const INACTIVA = '00000000-0000-4000-8000-00000000f040'
const INACTIVA_P = '00000000-0000-4000-8000-00000000f041'
const SIN_PERFIL = '00000000-0000-4000-8000-00000000f050'

const ESQUEMA = `
  set time zone 'UTC';
  create role anon nologin;
  create table public.workspaces (id uuid primary key, slug text, config_extra jsonb default '{}');
  create table public.staff (id uuid primary key, workspace_id uuid, full_name text, is_active boolean default true, profile_id uuid);
  create table public.negocios (id uuid primary key, workspace_id uuid, codigo text, nombre text, estado text default 'abierto');
  create table public.negocio_responsables (
    negocio_id uuid, staff_id uuid, assigned_at timestamptz default now(), assigned_by uuid, rol text,
    primary key (negocio_id, staff_id)
  );
  create table public.notificaciones (
    id uuid primary key default gen_random_uuid(), workspace_id uuid, destinatario_id uuid, tipo text, contenido text,
    entidad_tipo text, entidad_id uuid, deep_link text, metadata jsonb, estado text, created_at timestamptz default now()
  );
  create table public.falla_aviso (activa boolean);
  insert into public.falla_aviso values (false);
  create or replace function public.crear_notificacion(
    p_workspace_id uuid, p_destinatario_id uuid, p_tipo text, p_contenido text,
    p_entidad_tipo text default null, p_entidad_id uuid default null, p_deep_link text default null,
    p_metadata jsonb default '{}', p_permitir_repetidas boolean default false) returns uuid language plpgsql as $$
  declare v uuid;
  begin
    if (select activa from falla_aviso) then raise exception 'la campanita no está'; end if;
    insert into notificaciones (workspace_id, destinatario_id, tipo, contenido, entidad_tipo, entidad_id, deep_link, metadata, estado)
    values (p_workspace_id, p_destinatario_id, p_tipo, p_contenido, p_entidad_tipo, p_entidad_id, p_deep_link, p_metadata, 'pendiente')
    returning id into v;
    return v;
  end $$;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  insert into vault.decrypted_secrets values ('NOTIFICAR_ETAPA_SECRET', 'secreto'), ('SUPABASE_FUNCTIONS_URL', 'https://x.functions');
  create schema net;
  create table net.llamadas (url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$
    insert into net.llamadas values (url, body, headers) returning 1::bigint
  $$;

  insert into workspaces values ('${WS}', 'agencia', '{"avisar_asignacion": true}'), ('${WS_APAGADO}', 'otra', '{}');
  insert into negocios values
    ('${NEG}', '${WS}', 'M1 26 4', 'SAN ANDRÉS', 'abierto'),
    ('${NEG_CERRADO}', '${WS}', 'M1 26 5', 'CUSCO', 'completado'),
    ('${NEG_APAGADO}', '${WS_APAGADO}', 'P1 26 1', 'MIAMI', 'abierto');
  insert into staff values
    ('${EDGAR}', '${WS}', 'Edgar Alba', true, '${EDGAR_P}'),
    ('${TATI}', '${WS}', 'Tatiana Ríos', true, '${TATI_P}'),
    ('${INACTIVA}', '${WS}', 'Ina Activa', false, '${INACTIVA_P}'),
    ('${SIN_PERFIL}', '${WS}', 'Sin Perfil', true, null);
`

let db: PGlite
const filas = async <T,>(sql: string) => (await db.query<T>(sql)).rows
const avisos = () => filas<{ destinatario_id: string; contenido: string; metadata: { mensaje: string; rol: string | null }; deep_link: string }>(
  `select destinatario_id, contenido, metadata, deep_link from notificaciones order by created_at`)
const llamadas = () => filas<{ url: string; body: Record<string, unknown> }>('select url, body from net.llamadas')
const asignar = (negocio: string, staff: string, por: string | null, rol: string | null = 'comercial') =>
  db.query('insert into negocio_responsables (negocio_id, staff_id, assigned_by, rol) values ($1, $2, $3, $4)', [negocio, staff, por, rol])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(MIGRACION)
})

beforeEach(async () => {
  await db.exec(`delete from negocio_responsables; delete from notificaciones; delete from net.llamadas; update falla_aviso set activa = false;
    delete from staff where workspace_id = '${WS_APAGADO}';`)
})

describe('aviso de asignación (trigger sobre negocio_responsables)', () => {
  it('Tatiana asigna a Edgar: campanita para Edgar y el correo por pg_net', async () => {
    await asignar(NEG, EDGAR, TATI_P)
    const [a] = await avisos()
    const t = textoAvisoAsignacion({ codigo: 'M1 26 4', nombre: 'SAN ANDRÉS', rol: 'comercial', quienAsigna: 'Tatiana Ríos' })
    expect(a).toMatchObject({ destinatario_id: EDGAR_P, contenido: t.titulo, deep_link: `/negocios/${NEG}` })
    expect(a.metadata.mensaje).toBe(t.mensaje)
    expect(a.contenido).toBe('Te asignaron M1 26 4 · SAN ANDRÉS')
    expect(a.metadata.mensaje).toBe('Tatiana Ríos te dejó como responsable (comercial) de este negocio.')
    expect(await llamadas()).toEqual([{ url: 'https://x.functions/avisar-asignacion', body: { negocio_id: NEG, staff_id: EDGAR, asignado_por: TATI_P } }])
  })

  it('quien se asigna a sí misma no recibe aviso', async () => {
    await asignar(NEG, TATI, TATI_P)
    expect(await avisos()).toEqual([])
    expect(await llamadas()).toEqual([])
  })

  it('la asignación automática (sin quien asigne) sí avisa, con el texto sin autor', async () => {
    await asignar(NEG, EDGAR, null, 'operaciones')
    const [a] = await avisos()
    expect(a.metadata.mensaje).toBe(textoAvisoAsignacion({ codigo: 'M1 26 4', nombre: 'SAN ANDRÉS', rol: 'operaciones', quienAsigna: null }).mensaje)
    expect(await llamadas()).toHaveLength(1)
  })

  it('sin la clave del workspace, inactiva, sin perfil o negocio cerrado: nada', async () => {
    await db.query(`insert into staff values ('00000000-0000-4000-8000-00000000f060', '${WS_APAGADO}', 'Otra', true, '00000000-0000-4000-8000-00000000f061')`)
    await asignar(NEG_APAGADO, '00000000-0000-4000-8000-00000000f060', TATI_P)
    await asignar(NEG, INACTIVA, TATI_P)
    await asignar(NEG, SIN_PERFIL, TATI_P, 'operaciones')
    await asignar(NEG_CERRADO, EDGAR, TATI_P)
    expect(await avisos()).toEqual([])
    expect(await llamadas()).toEqual([])
  })

  it('reasignar a la misma persona (el upsert la actualiza) no avisa otra vez', async () => {
    await asignar(NEG, EDGAR, TATI_P)
    await db.query(`insert into negocio_responsables (negocio_id, staff_id, assigned_by, rol) values ($1, $2, $3, 'comercial')
      on conflict (negocio_id, staff_id) do update set assigned_by = excluded.assigned_by, rol = excluded.rol`, [NEG, EDGAR, TATI_P])
    expect(await avisos()).toHaveLength(1)
  })

  it('quitar y volver a poner en minutos no es otro aviso', async () => {
    await asignar(NEG, EDGAR, TATI_P)
    await db.query('delete from negocio_responsables where negocio_id = $1 and staff_id = $2', [NEG, EDGAR])
    await asignar(NEG, EDGAR, TATI_P)
    expect(await avisos()).toHaveLength(1)
    expect(await llamadas()).toHaveLength(1)
  })

  it('un fallo del aviso no tumba la asignación', async () => {
    await db.query('update falla_aviso set activa = true')
    await asignar(NEG, EDGAR, TATI_P)
    expect(await filas('select staff_id from negocio_responsables')).toEqual([{ staff_id: EDGAR }])
    expect(await avisos()).toEqual([])
  })

  it('la función no queda ejecutable por anon', async () => {
    const [r] = await filas<{ puede: boolean }>(`select has_function_privilege('anon', 'public.avisar_asignacion_responsable()', 'execute') as puede`)
    expect(r.puede).toBe(false)
  })
})
