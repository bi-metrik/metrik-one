import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de la cola `envios_factura_cuota`, ejecutada en PGlite contra un esquema mínimo:
 * `vault`, `net.http_post` y `pg_cron` son dobles que anotan lo que se les pide.
 *
 * Lo que fija: el trigger encola con CUALQUIER camino (un INSERT por SQL, sin sesión), un UPDATE
 * que no cambia el contenido no encola, el mismo contenido nunca entra dos veces, cada fila nueva
 * llama a la función con `{envio_id}`, y el job solo reintenta lo que debe.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261028120000_envios_factura_cuota.sql')

const ESQUEMA_BASE = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;

  create table public.workspaces (id uuid primary key);
  create table public.plan_cobro_cuotas (id uuid primary key);
  create table public.facturas_cuota (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    plan_cobro_cuota_id uuid not null unique references public.plan_cobro_cuotas(id),
    numero text not null,
    pdf_path text, pdf_sha256 text, xml_path text, xml_sha256 text,
    updated_at timestamptz not null default now()
  );

  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  insert into vault.decrypted_secrets values
    ('NOTIFICAR_ETAPA_SECRET', 'secreto'), ('SUPABASE_FUNCTIONS_URL', 'https://x.functions.supabase.co');

  create schema net;
  create table net.llamadas (url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as
    $f$ insert into net.llamadas values (url, body, headers) returning 1::bigint $f$;

  create schema cron;
  create table cron.job (jobname text primary key, schedule text, command text);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as
    $f$ insert into cron.job values (n, s, c) returning 1::bigint $f$;
  create function cron.unschedule(n text) returns boolean language sql as
    $f$ delete from cron.job where jobname = n returning true $f$;

  insert into public.workspaces values ('00000000-0000-0000-0000-00000000000a');
  insert into public.plan_cobro_cuotas values ('00000000-0000-0000-0000-0000000000c1');
`

const WS = '00000000-0000-0000-0000-00000000000a'
const CUOTA = '00000000-0000-0000-0000-0000000000c1'
const P1 = 'a'.repeat(64)
const P2 = 'b'.repeat(64)
const X1 = 'c'.repeat(64)

let db: PGlite

async function envios() {
  return (await db.query<{ numero: string; pdf_sha256: string | null; xml_sha256: string | null; estado: string }>(
    `select numero, pdf_sha256, xml_sha256, estado from public.envios_factura_cuota order by created_at, numero`,
  )).rows
}
async function llamadas() {
  return (await db.query<{ url: string; body: { envio_id: string }; headers: Record<string, string> }>(
    `select url, body, headers from net.llamadas`,
  )).rows
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

beforeEach(async () => {
  await db.exec(`delete from public.envios_factura_cuota; delete from public.facturas_cuota; delete from net.llamadas;`)
})

afterAll(async () => {
  await db.close()
})

describe('envios_factura_cuota: el trigger', () => {
  it('un INSERT por SQL (sin sesión) encola y llama a la función con {envio_id} y el secreto', async () => {
    await db.exec(`insert into public.facturas_cuota (workspace_id, plan_cobro_cuota_id, numero, pdf_path, pdf_sha256)
      values ('${WS}', '${CUOTA}', 'FE-1', 'p', '${P1}')`)
    const filas = await envios()
    expect(filas).toEqual([{ numero: 'FE-1', pdf_sha256: P1, xml_sha256: null, estado: 'pendiente' }])
    const ll = await llamadas()
    expect(ll).toHaveLength(1)
    expect(ll[0].url).toBe('https://x.functions.supabase.co/enviar-factura-cuota')
    expect(ll[0].headers.Authorization).toBe('Bearer secreto')
    const id = (await db.query<{ id: string }>(`select id from public.envios_factura_cuota`)).rows[0].id
    expect(ll[0].body).toEqual({ envio_id: id })
  })

  it('llega el XML después: otra fila; un UPDATE sin cambio de contenido no encola', async () => {
    await db.exec(`insert into public.facturas_cuota (workspace_id, plan_cobro_cuota_id, numero, pdf_path, pdf_sha256)
      values ('${WS}', '${CUOTA}', 'FE-1', 'p', '${P1}')`)
    await db.exec(`update public.facturas_cuota set xml_path = 'x', xml_sha256 = '${X1}'`)
    await db.exec(`update public.facturas_cuota set updated_at = now(), numero = 'FE-1', pdf_sha256 = '${P1}'`)
    await db.exec(`update public.facturas_cuota set pdf_path = 'otra-ruta'`)
    expect((await envios()).map((e) => e.xml_sha256)).toEqual([null, X1])
    expect(await llamadas()).toHaveLength(2)
  })

  it('volver a un contenido ya encolado no lo encola de nuevo (UNIQUE con nulos iguales)', async () => {
    await db.exec(`insert into public.facturas_cuota (workspace_id, plan_cobro_cuota_id, numero, pdf_path, pdf_sha256)
      values ('${WS}', '${CUOTA}', 'FE-1', 'p', '${P1}')`)
    await db.exec(`update public.facturas_cuota set pdf_sha256 = '${P2}'`)
    await db.exec(`update public.facturas_cuota set pdf_sha256 = '${P1}'`)
    expect((await envios()).map((e) => e.pdf_sha256).sort()).toEqual([P1, P2].sort())
    expect(await llamadas()).toHaveLength(2)
  })

  it('cambiar solo el número es contenido nuevo', async () => {
    await db.exec(`insert into public.facturas_cuota (workspace_id, plan_cobro_cuota_id, numero, pdf_path, pdf_sha256)
      values ('${WS}', '${CUOTA}', 'FE-1', 'p', '${P1}')`)
    await db.exec(`update public.facturas_cuota set numero = 'FE-2'`)
    expect((await envios()).map((e) => e.numero).sort()).toEqual(['FE-1', 'FE-2'])
  })
})

describe('envios_factura_cuota: los reintentos', () => {
  it('el job queda registrado cada 10 minutos', async () => {
    const r = await db.query<{ schedule: string; command: string }>(
      `select schedule, command from cron.job where jobname = 'enviar-factura-cuota-reintentos'`,
    )
    expect(r.rows).toEqual([{ schedule: '*/10 * * * *', command: 'select public.reintentar_envios_factura_cuota();' }])
  })

  it('reintenta pendientes y fallidos con < 3 intentos, entre 2 min y 7 días, sin correo y sin candado vivo', async () => {
    await db.exec(`insert into public.facturas_cuota (id, workspace_id, plan_cobro_cuota_id, numero, pdf_path, pdf_sha256)
      values ('00000000-0000-0000-0000-0000000000f1', '${WS}', '${CUOTA}', 'FE-1', 'p', '${P1}')`)
    await db.exec(`delete from public.envios_factura_cuota; delete from net.llamadas;`)
    const fila = (n: string, extra: string) =>
      `insert into public.envios_factura_cuota (workspace_id, factura_cuota_id, plan_cobro_cuota_id, numero, estado, intentos, created_at, correo_enviado_at, tomado_at)
       values ('${WS}', '00000000-0000-0000-0000-0000000000f1', '${CUOTA}', '${n}', ${extra})`
    await db.exec(`
      ${fila('SI-PEND', `'pendiente', 0, now() - interval '5 min', null, null`)};
      ${fila('SI-FALL', `'fallido', 2, now() - interval '1 hour', null, now() - interval '10 min'`)};
      ${fila('NO-RECIEN', `'pendiente', 0, now() - interval '1 min', null, null`)};
      ${fila('NO-AGOTADO', `'fallido', 3, now() - interval '1 hour', null, null`)};
      ${fila('NO-VIEJO', `'pendiente', 0, now() - interval '8 days', null, null`)};
      ${fila('NO-ENVIADO', `'enviado', 0, now() - interval '1 hour', now(), null`)};
      ${fila('NO-ACUSE-FALLIDO', `'fallido', 0, now() - interval '1 hour', now(), null`)};
      ${fila('NO-OMITIDO', `'omitido', 0, now() - interval '1 hour', null, null`)};
      ${fila('NO-TOMADO', `'pendiente', 0, now() - interval '1 hour', null, now() - interval '1 min'`)};
    `)
    const r = await db.query<{ n: number }>(`select public.reintentar_envios_factura_cuota() as n`)
    expect(r.rows[0].n).toBe(2)
    const ids = (await llamadas()).map((l) => l.body.envio_id)
    const nombres = (await db.query<{ numero: string }>(
      `select numero from public.envios_factura_cuota where id = any($1::uuid[]) order by numero`, [ids],
    )).rows.map((x) => x.numero)
    expect(nombres).toEqual(['SI-FALL', 'SI-PEND'])
  })
})

describe('envios_factura_cuota: permisos', () => {
  it('RLS encendida y ninguna de las tres funciones ejecutable por anon ni authenticated', async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.envios_factura_cuota'::regclass`,
    )
    expect(rls.rows[0].relrowsecurity).toBe(true)
    for (const f of [
      'public.disparar_envio_factura_cuota(uuid)',
      'public.encolar_envio_factura_cuota()',
      'public.reintentar_envios_factura_cuota()',
    ]) {
      for (const rol of ['anon', 'authenticated']) {
        const r = await db.query<{ puede: boolean }>(`select has_function_privilege('${rol}', '${f}', 'execute') as puede`)
        expect(r.rows[0].puede, `${rol} ${f}`).toBe(false)
      }
    }
  })
})
