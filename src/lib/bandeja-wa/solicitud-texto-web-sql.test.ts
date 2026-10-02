import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de lo pegado en la web (20261002120000), ejecutada de verdad en PGlite encima de
 * las de la bandeja. Lo que se prueba vive en la base: el canal, el teléfono nulo SOLO en lo web,
 * el motivo de cierre `web`, el estado `por_confirmar`, que las filas de antes quedan `whatsapp`
 * y que el cron sigue igual para WhatsApp.
 */

const MIG = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIG, a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'
const TEL = '573001112233'

const BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.workspaces (id uuid primary key, config_extra jsonb default '{}'::jsonb, modules jsonb default '{}'::jsonb);
  create table public.staff (id uuid primary key, workspace_id uuid, profile_id uuid);
  create table public.wa_collaborators (id uuid primary key, workspace_id uuid);
  create table public.lineas_negocio (id uuid primary key);
  create table public.contactos (id uuid primary key);
  create table public.negocios (id uuid primary key);
  create function public.current_user_workspace_id() returns uuid language sql stable
    as $$ select nullif(current_setting('app.ws', true), '')::uuid $$;
  create schema vault;
  create table vault.secrets (name text primary key, secret text not null);
  create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
  insert into vault.secrets values ('SUPABASE_FUNCTIONS_URL', 'https://x.functions'), ('WA_ALERTS_SECRET', 's3cr3t');
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint
    language sql as $$
      insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid $$;
  create function cron.unschedule(job_name text) returns boolean
    language sql as $$ delete from cron.job where jobname = job_name returning true $$;
  create schema net;
  create table net.llamadas (url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb) returns bigint
    language sql as $$ insert into net.llamadas values (url, body, headers) returning 1::bigint $$;
  insert into public.workspaces (id) values ('${WS}');
`

const PREVIAS = [
  '20260925200000_bandeja_wa_solicitudes.sql',
  '20260929100000_bandeja_wa_entendimiento.sql',
  '20260929100100_cron_bandeja_wa_entendimiento.sql',
  '20260930100000_bandeja_wa_negocio_existente.sql',
  '20261001120000_bandeja_wa_varios_viajes.sql',
]

let db: PGlite
let entregaVieja: string

async function correrCron(): Promise<number> {
  const job = await db.query<{ command: string }>(`select command from cron.job where jobname = 'wa-bandeja-entendimiento'`)
  await db.exec('delete from net.llamadas')
  await db.exec(job.rows[0].command)
  return (await db.query<{ n: number }>('select count(*)::int as n from net.llamadas')).rows[0].n
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  for (const m of PREVIAS) await db.exec(leer(m))
  // Una fila de antes de la migración: tiene que quedar `whatsapp` y cumplir los checks nuevos.
  const r = await db.query<{ id: string }>(
    `insert into public.wa_bandeja_entregas (workspace_id, remitente_phone, estado, cerrada_at, motivo_cierre)
     values ($1, $2, 'con_cliente', now(), 'palabra_cierre') returning id`, [WS, TEL])
  entregaVieja = r.rows[0].id
  await db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado) values ($1, $2, $3, 'negocio_creado')`, [WS, entregaVieja, TEL])
  await db.exec(leer('20261002120000_bandeja_solicitud_texto_web.sql'))
}, 30_000)

afterAll(async () => { await db.close() })

beforeEach(async () => {
  await db.query('delete from public.wa_bandeja_entendimientos where entrega_id <> $1', [entregaVieja])
  await db.exec('delete from public.wa_bandeja_mensajes;')
  await db.query('delete from public.wa_bandeja_entregas where id <> $1', [entregaVieja])
})

const insEntrega = (canal: string | null, phone: string | null, motivo = 'web') => db.query<{ id: string }>(
  `insert into public.wa_bandeja_entregas (workspace_id, remitente_phone, estado, cerrada_at, motivo_cierre${canal ? ', canal' : ''})
   values ($1, $2, 'con_cliente', now(), $3${canal ? ', $4' : ''}) returning id`,
  canal ? [WS, phone, motivo, canal] : [WS, phone, motivo])

describe('lo de antes queda de WhatsApp', () => {
  it('las filas que ya existían quedan canal whatsapp, con su teléfono', async () => {
    const e = await db.query<{ canal: string }>('select canal from public.wa_bandeja_entregas where id = $1', [entregaVieja])
    const x = await db.query<{ canal: string }>('select canal from public.wa_bandeja_entendimientos where entrega_id = $1', [entregaVieja])
    expect(e.rows[0].canal).toBe('whatsapp')
    expect(x.rows[0].canal).toBe('whatsapp')
  })

  it('una entrega de WhatsApp sin teléfono sigue siendo imposible; tampoco un canal inventado', async () => {
    await expect(insEntrega(null, null, 'palabra_cierre')).rejects.toThrow(/wa_bandeja_entregas_telefono_web/)
    await expect(insEntrega('correo', TEL, 'palabra_cierre')).rejects.toThrow(/wa_bandeja_entregas_canal/)
  })
})

describe('lo pegado en la web', () => {
  it('entrega web sin teléfono, cerrada con motivo web; mensaje con id web: sin teléfono; entendimiento por_confirmar', async () => {
    const e = (await insEntrega('web', null)).rows[0].id
    await db.query(
      `insert into public.wa_bandeja_mensajes (workspace_id, entrega_id, wa_message_id, remitente_phone, tipo, cuerpo, reenviado)
       values ($1, $2, 'web:00000000-0000-4000-8000-000000000001', null, 'text', 'Lisboa en marzo', true)`, [WS, e])
    await db.query(
      `insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, canal, remitente_phone, estado)
       values ($1, $2, 'web', null, 'por_confirmar')`, [WS, e])
    const r = await db.query<{ estado: string }>('select estado from public.wa_bandeja_entendimientos where entrega_id = $1', [e])
    expect(r.rows[0].estado).toBe('por_confirmar')
  })

  it('un mensaje sin teléfono que no es web, o un entendimiento de WhatsApp sin teléfono, no entran', async () => {
    const e = (await insEntrega('web', null)).rows[0].id
    await expect(db.query(
      `insert into public.wa_bandeja_mensajes (workspace_id, entrega_id, wa_message_id, remitente_phone, tipo) values ($1, $2, 'wamid.X', null, 'text')`, [WS, e],
    )).rejects.toThrow(/wa_bandeja_mensajes_telefono_web/)
    await expect(db.query(
      `insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado) values ($1, $2, null, 'procesando')`, [WS, e],
    )).rejects.toThrow(/wa_bandeja_entendimientos_telefono_web/)
  })

  it('un entendimiento web en error con los intentos agotados no despierta el cron', async () => {
    const e = (await insEntrega('web', null)).rows[0].id
    await db.query(
      `insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, canal, remitente_phone, estado, intentos)
       values ($1, $2, 'web', null, 'error', 3)`, [WS, e])
    expect(await correrCron()).toBe(0)
  })
})
