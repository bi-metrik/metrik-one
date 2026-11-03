/**
 * El esquema mínimo (roles, vault, cron, storage y las tablas que tocan las migraciones de términos) para
 * ejecutar en PGlite las migraciones REALES de los Términos de los CDA. Copia del de
 * `terminos-v1-4-sql.test.ts`, que no se exporta (importar un archivo de pruebas corre sus pruebas).
 */

export const WS_METRIK = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
export const LINEA_VALIDA = '7d9f8994-a843-4032-a632-a6286ec61d94'
export const MAURICIO = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'

export const ESQUEMA_BASE = `
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
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);

  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles (
    id uuid primary key,
    workspace_id uuid references public.workspaces(id),
    role text,
    full_name text,
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

  insert into public.workspaces (id, slug) values ('${WS_METRIK}', 'metrik');
  insert into public.profiles (id, workspace_id, role, full_name, platform_admin)
    values ('${MAURICIO}', '${WS_METRIK}', 'owner', 'Mauricio', true);
  insert into public.lineas_negocio (id, nombre) values ('${LINEA_VALIDA}', 'Valida');
  insert into public.catalogo_servicios values ('valida-cda-licencia', 'Suscripción Valida por CDA', 'valida_consulta', 'ciclo');
`
