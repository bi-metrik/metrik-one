import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de varios viajes (20261001120000), ejecutada de verdad en PGlite encima de las de
 * la bandeja. Lo que se prueba es lo que vive en la base: un entendimiento por (entrega, viaje), la
 * asignación por mensaje, los estados y confirmaciones nuevas, y que el cron no cambió.
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

let db: PGlite

async function entrega(estado = 'con_cliente'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.wa_bandeja_entregas (workspace_id, remitente_phone, estado, cerrada_at, motivo_cierre)
     values ($1, $2, $3, now(), 'palabra_cierre') returning id`, [WS, TEL, estado])
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
  for (const m of [
    '20260925200000_bandeja_wa_solicitudes.sql',
    '20260929100000_bandeja_wa_entendimiento.sql',
    '20260929100100_cron_bandeja_wa_entendimiento.sql',
    '20260930100000_bandeja_wa_negocio_existente.sql',
    '20261001120000_bandeja_wa_varios_viajes.sql',
  ]) await db.exec(leer(m))
}, 30_000)

afterAll(async () => { await db.close() })

beforeEach(async () => {
  await db.exec('delete from public.wa_bandeja_entendimientos; delete from public.wa_bandeja_mensajes; delete from public.wa_bandeja_entregas;')
})

const insEnt = `insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado, segmento, intentos)
                values ($1, $2, $3, $4, $5, 1) on conflict (entrega_id, segmento) do nothing returning id`

describe('un entendimiento por viaje del reparto', () => {
  it('la fila 0 (la entrega) y una por cada viaje; el mismo (entrega, viaje) no entra dos veces', async () => {
    const e = await entrega()
    expect((await db.query(insEnt, [WS, e, TEL, 'repartida', 0])).rows).toHaveLength(1)
    expect((await db.query(insEnt, [WS, e, TEL, 'procesando', 1])).rows).toHaveLength(1)
    expect((await db.query(insEnt, [WS, e, TEL, 'procesando', 2])).rows).toHaveLength(1)
    expect((await db.query(insEnt, [WS, e, TEL, 'procesando', 1])).rows).toHaveLength(0)
  })

  it('las filas que ya existían quedan como segmento 0', async () => {
    const e = await entrega()
    await db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado) values ($1, $2, $3, 'negocio_creado')`, [WS, e, TEL])
    const r = await db.query<{ segmento: number }>('select segmento from public.wa_bandeja_entendimientos')
    expect(r.rows).toEqual([{ segmento: 0 }])
  })

  it('confirmacion_pendiente y segmento son vocabulario cerrado', async () => {
    const e = await entrega()
    await expect(db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado, confirmacion_pendiente) values ($1, $2, $3, 'esperando_negocio', 'otra')`, [WS, e, TEL]))
      .rejects.toThrow(/wa_bandeja_entendimientos_confirmacion/)
    await expect(db.query(insEnt, [WS, e, TEL, 'procesando', -1])).rejects.toThrow(/wa_bandeja_entendimientos_segmento_valido/)
    for (const c of ['cruce', 'sin_solicitud', 'dos_viajes']) {
      const e2 = await entrega()
      await db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado, confirmacion_pendiente) values ($1, $2, $3, 'esperando_negocio', $4)`, [WS, e2, TEL, c])
    }
  })
})

describe('la asignación por mensaje y el reparto', () => {
  it('segmento, asignación y clase en el mensaje; plan_viajes en la entrega', async () => {
    const e = await entrega('esperando_cliente')
    await db.query(`update public.wa_bandeja_entregas set plan_viajes = $2, plan_confirmado_at = now() where id = $1`, [e, JSON.stringify({ version: 1, mensajes: [] })])
    const ins = `insert into public.wa_bandeja_mensajes (workspace_id, entrega_id, wa_message_id, remitente_phone, tipo, cuerpo, segmento, asignacion, clase)
                 values ($1, $2, $3, $4, 'text', 'x', $5, $6, $7)`
    await db.query(ins, [WS, e, 'w1', TEL, 1, JSON.stringify({ por: 'encabezado' }), 'cliente'])
    await db.query(ins, [WS, e, 'w2', TEL, null, null, 'encabezado'])
    await expect(db.query(ins, [WS, e, 'w3', TEL, 0, null, null])).rejects.toThrow(/wa_bandeja_mensajes_segmento/)
    await expect(db.query(ins, [WS, e, 'w4', TEL, null, null, 'otra'])).rejects.toThrow(/wa_bandeja_mensajes_clase/)
  })
})

describe('un encabezado no es la respuesta a una pregunta pendiente (QA de #971, punto 12)', () => {
  const registrar = (wamid: string, texto: string, puede: boolean | null) => db.query<{ accion: string; entrega: string }>(
    `select * from public.wa_bandeja_registrar_mensaje($1, $2, null, null, $3, 'text', $4, 'texto', false, false, null, null, null, false, 24${puede === null ? '' : ', $5'})`,
    puede === null ? [WS, TEL, wamid, texto] : [WS, TEL, wamid, texto, puede])

  it('con un resumen pendiente, «Carolina» como encabezado abre otra entrega; «sí» sigue siendo la respuesta', async () => {
    const e = await entrega('esperando_cliente')
    await db.query(`update public.wa_bandeja_entregas set pregunta_enviada_at = now() where id = $1`, [e])
    const enc = (await registrar('w-enc', 'Carolina', false)).rows[0]
    expect(enc.accion).toBe('abrir')
    expect(enc.entrega).not.toBe(e)
    // Se cierra la tanda nueva para que el «sí» no caiga en ella.
    await db.query(`update public.wa_bandeja_entregas set estado = 'esperando_cliente', cerrada_at = now(), motivo_cierre = 'palabra_cierre' where id = $1`, [enc.entrega])
    await db.query(`update public.wa_bandeja_entregas set pregunta_enviada_at = now() - interval '1 minute' where id = $1`, [enc.entrega])
    const si = (await registrar('w-si', 'sí', null)).rows[0]
    expect(si.accion).toBe('respuesta_cliente')
  })

  it('la firma vieja ya no existe y la nueva solo la ejecuta el servidor', async () => {
    const r = await db.query<{ args: string; anon: boolean; svc: boolean }>(`
      select pg_get_function_identity_arguments(p.oid) as args, has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('service_role', p.oid, 'execute') as svc
        from pg_proc p where p.proname = 'wa_bandeja_registrar_mensaje'`)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].args).toContain('p_puede_ser_respuesta boolean')
    expect([r.rows[0].anon, r.rows[0].svc]).toEqual([false, true])
  })

  it('la bandeja le dice a la base cuándo un escrito es encabezado, y no lo toma como respuesta', () => {
    const fuente = readFileSync(join(process.cwd(), 'supabase/functions/_shared/wa-bandeja.ts'), 'utf8')
    // Bot híbrido (2026-10-06): un escrito nunca es la respuesta por adivinanza en la base; si había una pregunta
    // abierta, la leyó antes el punto de decisión.
    expect(fuente).toContain('p_puede_ser_respuesta: !esEncabezado && !escrito')
    expect(fuente).toContain('await atenderEnPuntoDeDecision(supabase, user, message, config)')
  })
})

describe('el cron no cambió', () => {
  it('un reparto confirmado (fila 0 repartida) no es trabajo; un viaje del reparto en error se reintenta', async () => {
    const e = await entrega()
    await db.query(insEnt, [WS, e, TEL, 'repartida', 0])
    await db.query(insEnt, [WS, e, TEL, 'negocio_actualizado', 1])
    expect(await correrCron()).toBe(0)
    await db.query(insEnt, [WS, e, TEL, 'error', 2])
    expect(await correrCron()).toBe(1)
  })

  it('una confirmación pendiente se atiende cuando llega la respuesta', async () => {
    const e = await entrega()
    await db.query(`insert into public.wa_bandeja_entendimientos (workspace_id, entrega_id, remitente_phone, estado, confirmacion_pendiente) values ($1, $2, $3, 'esperando_negocio', 'cruce')`, [WS, e, TEL])
    expect(await correrCron()).toBe(0)
    await db.exec(`update public.wa_bandeja_entendimientos set respuesta_negocio = 'sí'`)
    expect(await correrCron()).toBe(1)
  })
})
