import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migracion del aviso de datos del bot (`20261005160000_aviso_datos_bot.sql`), EJECUTADA.
 *
 * Postgres en memoria (PGlite) con las migraciones reales que dan forma a `aceptaciones_terminos`
 * y a la purga, en el orden en que llegaron a produccion, y despues esta. Se siembra antes una
 * aceptacion por WhatsApp como las que ya existen, para probar que la migracion no la toca.
 *
 * Lo que se fija es lo que la base decide sola, aunque el webhook tuviera un defecto:
 *   - una sola solicitud pendiente por persona, workspace y version del aviso;
 *   - una fila del aviso es del canal whatsapp, sin negocio y con la version exacta del PDF;
 *   - su version no cambia despues de creada (pendiente o respondida);
 *   - lo retenido es server-only, no se duplica por wamid, muere con su aceptacion y el cron lo
 *     borra al vencer;
 *   - el PDF canonico de una version no sale por la purga de objetos.
 * Ids, telefonos y textos son ficticios.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (archivo: string) => readFileSync(join(MIGRACIONES, archivo), 'utf8')
const MIGRACION = '20261005160000_aviso_datos_bot.sql'

const WS = '00000000-0000-4000-8000-000000000001'
const NEG = '00000000-0000-4000-8000-0000000000b1'
const DOC = '00000000-0000-4000-8000-0000000000e1'
const EMP = '00000000-0000-4000-8000-0000000000a1'
const ACE_VIEJA = '00000000-0000-4000-8000-0000000000f9'
const SHA = (c: string) => c.repeat(64)
const URL_PDF = 'https://proyecto.supabase.co/storage/v1/object/sign/aceptaciones-documentos/avisos/aviso-bot-v1.pdf?token=x'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text not null);
  create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;

  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint
    language sql as $$
      insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid $$;
  create function cron.unschedule(job_name text) returns boolean
    language sql as $$ delete from cron.job where jobname = job_name returning true $$;

  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false);

  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles (
    id uuid primary key,
    workspace_id uuid references public.workspaces(id),
    role text,
    platform_admin boolean not null default false
  );
  create table public.empresas (id uuid primary key, nombre text);
  create table public.lineas_negocio (id uuid primary key, nombre text);
  create table public.negocios (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    nombre text
  );
  create table public.cobros (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid references public.negocios(id),
    fecha date,
    monto numeric(15,2) not null default 0,
    monto_anulado numeric(15,2),
    fuente text,
    anulado_at timestamptz,
    notas text,
    siigo_recibo jsonb,
    plan_cobro_id uuid,
    numero_cuota integer,
    tipo_cobro text,
    created_at timestamptz not null default now()
  );
  create table public.catalogo_servicios (
    slug text primary key, nombre text not null, modulo text not null, disparador_cobro text not null
  );
  create table public.servicios_contratados (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    empresa_id uuid not null references public.empresas(id),
    negocio_id uuid not null references public.negocios(id),
    servicio_slug text not null references public.catalogo_servicios(slug),
    servicio_version integer not null,
    workspace_pagador_id uuid references public.workspaces(id),
    estado text not null default 'activo',
    vigente_desde date not null,
    vigente_hasta date,
    comision jsonb,
    correo_facturacion text
  );
  create table public.servicio_contratado_beneficiarios (
    servicio_contratado_id uuid not null references public.servicios_contratados(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id),
    primary key (servicio_contratado_id, workspace_id)
  );
  create table public.wa_message_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id),
    phone text not null,
    direction text not null,
    intent text,
    message_preview text,
    created_at timestamptz default now()
  );
  create table public.planes_cobro (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid not null references public.negocios(id),
    activo boolean not null default true,
    notas text
  );
  create table public.plan_cobro_cuotas (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    plan_cobro_id uuid not null references public.planes_cobro(id),
    numero integer not null,
    tipo text not null default 'cuota',
    monto numeric not null,
    fecha_vencimiento date not null,
    concepto_detalle text
  );
  create table public.bot_sessions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    user_phone text not null,
    context jsonb default '{}',
    expires_at timestamptz default (now() + interval '5 minutes')
  );

  create function public.current_user_workspace_id() returns uuid
    language sql stable as $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;
`

const SEMILLA = `
  insert into public.workspaces (id, slug) values ('${WS}', 'prueba');
  insert into public.negocios (id, workspace_id, nombre) values ('${NEG}', '${WS}', 'P1 26 1 Prueba');
  insert into public.empresas (id, nombre) values ('${EMP}', 'Empresa Ficticia SAS');
`

/** Una aceptacion por WhatsApp como las que ya hay en produccion, sembrada ANTES de esta migracion. */
const ACEPTACION_VIEJA = `
  insert into public.aceptaciones_terminos
    (id, workspace_id, negocio_id, telefono, nombre_aceptante, calidad, empresa_nombre,
     documento_titulo, documento_version, documento_url, documento_sha256, texto_aceptacion)
  values
    ('${ACE_VIEJA}', '${WS}', '${NEG}', '+573000000000', 'Persona Ficticia', 'apoderado', 'Empresa Ficticia',
     'Terminos', 'v1.0', 'https://proyecto.supabase.co/storage/v1/object/sign/aceptaciones-documentos/otra/v1.pdf?token=x',
     '${SHA('c')}', 'Acepto');
`

const VERSION = `
  insert into public.documentos_contractuales_versiones
    (id, workspace_id, slug, alcance, empresa_id, modulo, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde)
  values
    ('${DOC}', '${WS}', 'aviso-datos-bot', 'cliente', '${EMP}', null, 'Aviso de datos del bot', '1.0',
     '# Aviso', '${SHA('a')}', 'avisos/aviso-bot-v1.pdf', '${SHA('b')}', date '2026-01-01');
`

/** Fila del aviso con todo lo obligatorio; `extra` pisa columnas con expresiones SQL. */
function insertAviso(extra: Record<string, string> = {}) {
  const cols: Record<string, string> = {
    workspace_id: `'${WS}'`,
    telefono: `'+573001110001'`,
    nombre_aceptante: `'Ana Prueba'`,
    calidad: `'persona_natural'`,
    documento_titulo: `'Aviso de datos del bot'`,
    documento_version: `'1.0'`,
    documento_url: `'${URL_PDF}'`,
    documento_sha256: `'${SHA('b')}'`,
    texto_aceptacion: `'Acepta el aviso de datos para usar el bot.'`,
    canal: `'whatsapp'`,
    documento_version_id: `'${DOC}'`,
    aviso_datos_version: `'v1'`,
    ...extra,
  }
  return `insert into public.aceptaciones_terminos (${Object.keys(cols).join(', ')})
          values (${Object.values(cols).join(', ')})`
}

let db: PGlite

async function ensayo(sql: string): Promise<string> {
  await db.exec('begin')
  try {
    await db.exec(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  } finally {
    await db.exec('rollback')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(SEMILLA)
  await db.exec(leer('20260901000003_wa_envios.sql'))
  await db.exec(leer('20260915040000_aceptaciones_terminos.sql'))
  await db.exec(ACEPTACION_VIEJA)
  await db.exec(leer('20260915060000_purga_registros_bot.sql'))
  await db.exec(leer('20260916180000_modulo_valida_api.sql'))
  await db.exec(leer('20260916213000_mis_documentos_de_servicio_por_negocio.sql'))
  await db.exec(leer('20260917014500_aceptacion_terminos_en_modulo.sql'))
  await db.exec(leer('20260923220000_terminos_cda_designado_y_enlace_pago.sql'))
  await db.exec(leer('20260929030000_documentos_alcance_plantilla.sql'))
  await db.exec(VERSION)
  await db.exec(leer(MIGRACION))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('lo que ya existia', () => {
  it('las aceptaciones de antes quedan sin version de aviso y sin cambios', async () => {
    const r = await db.query(`select aviso_datos_version, estado, canal from public.aceptaciones_terminos where id = '${ACE_VIEJA}'`)
    expect(r.rows).toEqual([{ aviso_datos_version: null, estado: 'pendiente', canal: 'whatsapp' }])
  })
})

describe('la fila del aviso', () => {
  it('un colaborador sin usuario cabe: persona natural, sin empresa, sin negocio, sin usuario_id', async () => {
    expect(await ensayo(`${insertAviso()};`)).toBe('')
  })

  it('una sola pendiente por persona, workspace y version', async () => {
    expect(await ensayo(`${insertAviso()}; ${insertAviso()};`)).toMatch(/uq_aceptaciones_terminos_aviso_pendiente/)
    expect(await ensayo(`${insertAviso()}; ${insertAviso({ telefono: `'+573001110002'` })};`)).toBe('')
    expect(await ensayo(`${insertAviso()}; ${insertAviso({ aviso_datos_version: `'v2'` })};`)).toBe('')
  })

  it('despues de un rechazo se puede pedir de nuevo', async () => {
    expect(await ensayo(`
      ${insertAviso({ estado: `'rechazado'`, respondido_at: 'now()', reply_wamid: `'wamid.r'`, button_id: `'texto:no_acepto'`, payload_respuesta: `'{}'` })};
      ${insertAviso()};
    `)).toBe('')
  })

  it('es del canal whatsapp, sin negocio y con la version exacta del PDF', async () => {
    expect(await ensayo(`${insertAviso({ negocio_id: `'${NEG}'` })};`)).toMatch(/aceptaciones_terminos_aviso_datos/)
    expect(await ensayo(`${insertAviso({ documento_version_id: 'null' })};`)).toMatch(/aceptaciones_terminos_aviso_datos/)
    expect(await ensayo(`${insertAviso({ aviso_datos_version: `'  '` })};`)).toMatch(/aceptaciones_terminos_aviso_datos/)
  })

  it('su version no cambia: ni pendiente ni respondida', async () => {
    expect(await ensayo(`${insertAviso()}; update public.aceptaciones_terminos set aviso_datos_version = 'v2' where aviso_datos_version = 'v1';`))
      .toMatch(/la version del aviso no cambia/)
    expect(await ensayo(`
      ${insertAviso({ estado: `'aceptado'`, respondido_at: 'now()', reply_wamid: `'wamid.a'`, button_id: `'texto:acepto'`, payload_respuesta: `'{}'` })};
      update public.aceptaciones_terminos set aviso_datos_version = 'v2' where aviso_datos_version = 'v1';
    `)).toMatch(/no cambia|no se modifica/)
  })
})

describe('revocacion', () => {
  const aceptada = (extra: Record<string, string> = {}) => insertAviso({
    estado: `'aceptado'`, respondido_at: `now() - interval '1 day'`, reply_wamid: `'wamid.a'`,
    button_id: `'texto:acepto'`, payload_respuesta: `'{}'`, ...extra,
  })
  const revocar = (extra = '') => `update public.aceptaciones_terminos
       set revocada_at = now(), revocacion_motivo = 'Lo pidio la empresa'${extra}
     where aviso_datos_version = 'v1';`

  it('una aceptacion del aviso se revoca una vez y la fila sigue siendo la misma evidencia', async () => {
    await db.exec('begin')
    try {
      await db.exec(`${aceptada()}; ${revocar()}`)
      const r = await db.query<{ estado: string; revocada: boolean }>(
        `select estado, revocada_at is not null as revocada from public.aceptaciones_terminos where aviso_datos_version = 'v1'`)
      expect(r.rows).toEqual([{ estado: 'aceptado', revocada: true }])
      // Ya revocada, no se mueve ni se deshace.
      await expect(db.exec(`update public.aceptaciones_terminos set revocada_at = null where aviso_datos_version = 'v1'`)).rejects.toThrow(/no se modifica/)
    } finally {
      await db.exec('rollback')
    }
    expect(await ensayo(`${aceptada()}; ${revocar()} update public.aceptaciones_terminos set revocacion_motivo = 'otro' where aviso_datos_version = 'v1';`))
      .toMatch(/no se modifica/)
  })

  it('revocar no deja tocar nada mas de la fila', async () => {
    expect(await ensayo(`${aceptada()}; ${revocar(", texto_aceptacion = 'otro texto'")}`)).toMatch(/no se modifica/)
  })

  it('solo cabe en una aceptacion del aviso ya aceptada', async () => {
    expect(await ensayo(`${insertAviso()}; ${revocar()}`)).toMatch(/aceptaciones_terminos_revocada/)
    expect(await ensayo(`update public.aceptaciones_terminos set revocada_at = now() where id = '${ACE_VIEJA}';`))
      .toMatch(/aceptaciones_terminos_revocada/)
    expect(await ensayo(`${aceptada({ estado: `'rechazado'`, button_id: `'texto:no_acepto'` })}; ${revocar()}`))
      .toMatch(/aceptaciones_terminos_revocada|no se modifica/)
  })
})

describe('lo retenido', () => {
  const retener = (wamid: string, expira = "now() + interval '7 days'") => `
    insert into public.wa_mensajes_retenidos (aceptacion_id, workspace_id, telefono, wa_message_id, tipo, mensaje, meta_ts, expira_at)
    select id, workspace_id, telefono, '${wamid}', 'text', '{"type":"text","text":"gasto 20000 taxi"}', 1791212400, ${expira}
      from public.aceptaciones_terminos where aviso_datos_version = 'v1' and estado = 'pendiente';`

  it('es server-only: RLS activa y sin privilegios para anon ni authenticated', async () => {
    const r = await db.query<{ rls: boolean; anon: boolean; auth: boolean }>(`
      select c.relrowsecurity as rls,
             has_table_privilege('anon', c.oid, 'select') as anon,
             has_table_privilege('authenticated', c.oid, 'select') as auth
        from pg_class c where c.oid = 'public.wa_mensajes_retenidos'::regclass`)
    expect(r.rows).toEqual([{ rls: true, anon: false, auth: false }])
  })

  it('un mismo wamid se retiene una vez', async () => {
    expect(await ensayo(`${insertAviso()}; ${retener('wamid.1')} ${retener('wamid.1')}`)).toMatch(/uq_wa_mensajes_retenidos_wamid/)
  })

  it('muere con su aceptacion', async () => {
    await db.exec('begin')
    try {
      await db.exec(`${insertAviso()}; ${retener('wamid.2')}`)
      await db.exec(`delete from public.aceptaciones_terminos where aviso_datos_version = 'v1'`)
      const r = await db.query<{ n: number }>('select count(*)::int as n from public.wa_mensajes_retenidos')
      expect(r.rows[0].n).toBe(0)
    } finally {
      await db.exec('rollback')
    }
  })

  it('el cron borra lo vencido y nada mas', async () => {
    const job = await db.query<{ schedule: string; command: string }>(
      `select schedule, command from cron.job where jobname = 'purgar-retenidos-aviso-datos'`)
    expect(job.rows).toHaveLength(1)
    await db.exec('begin')
    try {
      await db.exec(`${insertAviso()}; ${retener('wamid.vivo')} ${retener('wamid.vencido', "now() - interval '1 minute'")}`)
      await db.exec(job.rows[0].command)
      const r = await db.query<{ wa_message_id: string }>('select wa_message_id from public.wa_mensajes_retenidos')
      expect(r.rows).toEqual([{ wa_message_id: 'wamid.vivo' }])
    } finally {
      await db.exec('rollback')
    }
  })
})

describe('la purga de objetos', () => {
  it('no entrega el PDF de una version de documento, aunque ninguna aceptacion lo nombre', async () => {
    await db.exec('begin')
    try {
      await db.exec(`
        insert into public.purga_storage_pendiente (bucket, ruta) values
          ('aceptaciones-documentos', 'avisos/aviso-bot-v1.pdf'),
          ('aceptaciones-documentos', 'huerfano/solo.pdf');`)
      const r = await db.query<{ ruta: string }>('select ruta from public.objetos_purga_bot_por_borrar()')
      expect(r.rows).toEqual([{ ruta: 'huerfano/solo.pdf' }])
      const cola = await db.query<{ ruta: string }>('select ruta from public.purga_storage_pendiente order by ruta')
      expect(cola.rows).toEqual([{ ruta: 'huerfano/solo.pdf' }])
    } finally {
      await db.exec('rollback')
    }
  })

  it('conserva su ACL: solo service_role (y el dueno) la ejecuta', async () => {
    const r = await db.query<{ grantee: string }>(`
      select case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
        from pg_proc p, aclexplode(p.proacl) a
       where p.oid = 'public.objetos_purga_bot_por_borrar()'::regprocedure and a.privilege_type = 'EXECUTE'
       order by 1`)
    expect(r.rows.map((x) => x.grantee)).toEqual(['postgres', 'service_role'])
  })
})
