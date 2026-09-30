import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración del paso de entendimiento, ejecutada de verdad en PGlite sobre la de la bandeja.
 *
 * Lo que se prueba aquí es lo que vive en la base: el reclamo por entrega (dos corridas no
 * procesan la misma), el papel nuevo de los mensajes, y que el cron solo llame cuando hay
 * trabajo. Las decisiones (esquema, filtro de valores, contacto, mensaje) están en
 * `supabase/functions/_shared/wa-entendimiento-reglas.test.ts`.
 */

const MIG = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIG, a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'
const STAFF = '00000000-0000-4000-8000-0000000000c1'
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
  insert into public.staff (id, workspace_id) values ('${STAFF}', '${WS}');
`

let db: PGlite

async function entrega(estado: string): Promise<string> {
  const cerrada = estado === 'abierta' ? 'null, null' : `now(), 'inactividad'`
  const r = await db.query<{ id: string }>(
    `insert into public.wa_bandeja_entregas (workspace_id, remitente_phone, estado, cerrada_at, motivo_cierre)
     values ($1, $2, $3, ${cerrada}) returning id`,
    [WS, TEL, estado],
  )
  return r.rows[0].id
}

async function correrCron(): Promise<number> {
  const job = await db.query<{ command: string }>(`select command from cron.job where jobname = 'wa-bandeja-entendimiento'`)
  await db.exec('delete from net.llamadas')
  await db.exec(job.rows[0].command)
  return (await db.query<{ n: number }>('select count(*)::int as n from net.llamadas')).rows[0].n
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(leer('20260925200000_bandeja_wa_solicitudes.sql'))
  await db.exec(leer('20260929100000_bandeja_wa_entendimiento.sql'))
  await db.exec(leer('20260929100100_cron_bandeja_wa_entendimiento.sql'))
  await db.exec(leer('20260930100000_bandeja_wa_negocio_existente.sql'))
}, 30_000)

afterAll(async () => { await db.close() })

beforeEach(async () => {
  await db.exec('delete from public.wa_bandeja_entendimientos; delete from public.wa_bandeja_mensajes; delete from public.wa_bandeja_entregas;')
})

describe('wa_bandeja_entendimientos', () => {
  it('una fila por entrega: el segundo reclamo no entra', async () => {
    const e = await entrega('con_cliente')
    const ins = `insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado, intentos)
                 values ($1, $2, $3, 'procesando', 1) on conflict (entrega_id) do nothing returning id`
    expect((await db.query(ins, [WS, e, TEL])).rows).toHaveLength(1)
    expect((await db.query(ins, [WS, e, TEL])).rows).toHaveLength(0)
  })

  it('el estado es vocabulario cerrado', async () => {
    const e = await entrega('con_cliente')
    await expect(db.query(
      `insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado) values ($1, $2, $3, 'listo')`,
      [WS, e, TEL],
    )).rejects.toThrow(/wa_bandeja_entendimientos_estado/)
  })

  it('el mensaje admite el papel respuesta_contacto y sigue rechazando otros', async () => {
    const e = await entrega('con_cliente')
    const ins = `insert into public.wa_bandeja_mensajes (workspace_id, entrega_id, wa_message_id, remitente_phone, tipo, papel, cuerpo)
                 values ($1, $2, $3, $4, 'text', $5, '2')`
    await db.query(ins, [WS, e, 'w1', TEL, 'respuesta_contacto'])
    await expect(db.query(ins, [WS, e, 'w2', TEL, 'otro'])).rejects.toThrow(/wa_bandeja_mensajes_papel/)
  })

  it('RLS encendido y sin nada para anon', async () => {
    const r = await db.query<{ rls: boolean; anon: boolean }>(`
      select c.relrowsecurity as rls, has_table_privilege('anon', 'public.wa_bandeja_entendimientos', 'select') as anon
      from pg_class c where c.relname = 'wa_bandeja_entendimientos'`)
    expect(r.rows[0]).toEqual({ rls: true, anon: false })
  })
})

describe('el cron solo llama cuando hay trabajo', () => {
  it('sin entregas: no llama', async () => {
    expect(await correrCron()).toBe(0)
  })

  it('una entrega abierta o esperando_cliente no es trabajo de este cron', async () => {
    await entrega('abierta')
    await entrega('esperando_cliente')
    expect(await correrCron()).toBe(0)
  })

  it('con_cliente sin entendimiento: llama, con la acción y el secreto del vault', async () => {
    await entrega('con_cliente')
    expect(await correrCron()).toBe(1)
    const l = await db.query<{ url: string; body: { action: string }; headers: { Authorization: string } }>('select * from net.llamadas')
    expect(l.rows[0].url).toBe('https://x.functions/wa-alerts')
    expect(l.rows[0].body.action).toBe('bandeja_entendimiento')
    expect(l.rows[0].headers.Authorization).toBe('Bearer s3cr3t')
  })

  it('ya entendida (negocio creado): no llama', async () => {
    const e = await entrega('con_cliente')
    await db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado) values ($1, $2, $3, 'negocio_creado')`, [WS, e, TEL])
    expect(await correrCron()).toBe(0)
  })

  it('esperando contacto: llama solo cuando llegó la respuesta', async () => {
    const e = await entrega('con_cliente')
    await db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado) values ($1, $2, $3, 'esperando_contacto')`, [WS, e, TEL])
    expect(await correrCron()).toBe(0)
    await db.exec(`update public.wa_bandeja_entendimientos set respuesta_contacto = '2'`)
    expect(await correrCron()).toBe(1)
  })

  it('en error: reintenta hasta el tercer intento', async () => {
    const e = await entrega('con_cliente')
    await db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado, intentos) values ($1, $2, $3, 'error', 2)`, [WS, e, TEL])
    expect(await correrCron()).toBe(1)
    await db.exec(`update public.wa_bandeja_entendimientos set intentos = 3`)
    expect(await correrCron()).toBe(0)
  })
})

describe('carga en un negocio existente (20260930100000)', () => {
  it('la entrega guarda la lista ofrecida', async () => {
    const e = await entrega('esperando_cliente')
    await db.query(`update public.wa_bandeja_entregas set negocio_opciones = $2 where id = $1`, [e, JSON.stringify([{ id: 'x', codigo: 'T1 26 14' }])])
    const r = await db.query<{ n: number }>(`select jsonb_array_length(negocio_opciones) as n from public.wa_bandeja_entregas where id = $1`, [e])
    expect(r.rows[0].n).toBe(1)
  })

  it('estados nuevos esperando_negocio y negocio_actualizado; destino es vocabulario cerrado', async () => {
    const e1 = await entrega('con_cliente')
    const e2 = await entrega('con_cliente')
    const ins = `insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado, destino) values ($1, $2, $3, $4, $5)`
    await db.query(ins, [WS, e1, TEL, 'esperando_negocio', null])
    await db.query(ins, [WS, e2, TEL, 'negocio_actualizado', 'existente'])
    const e3 = await entrega('con_cliente')
    await expect(db.query(ins, [WS, e3, TEL, 'procesando', 'otro'])).rejects.toThrow(/wa_bandeja_entendimientos_destino/)
    await expect(db.query(ins, [WS, e3, TEL, 'listo', null])).rejects.toThrow(/wa_bandeja_entendimientos_estado/)
  })

  it('el mensaje admite el papel respuesta_negocio', async () => {
    const e = await entrega('con_cliente')
    await db.query(
      `insert into public.wa_bandeja_mensajes (workspace_id, entrega_id, wa_message_id, remitente_phone, tipo, papel, cuerpo)
       values ($1, $2, 'w9', $3, 'text', 'respuesta_negocio', '2')`, [WS, e, TEL])
  })

  it('el cron llama cuando llegó la respuesta a la re-pregunta, no antes', async () => {
    const e = await entrega('con_cliente')
    await db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado) values ($1, $2, $3, 'esperando_negocio')`, [WS, e, TEL])
    expect(await correrCron()).toBe(0)
    await db.exec(`update public.wa_bandeja_entendimientos set respuesta_negocio = '2'`)
    expect(await correrCron()).toBe(1)
  })

  it('un negocio ya actualizado no es trabajo del cron', async () => {
    const e = await entrega('con_cliente')
    await db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado) values ($1, $2, $3, 'negocio_actualizado')`, [WS, e, TEL])
    expect(await correrCron()).toBe(0)
  })
})
