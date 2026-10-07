-- Origen del dato + lista de supresión ("BAJA") — requisito previo al primer outbound B2B.
-- Política METRIK v1.5 (5.5 y Anexo B); 02-legal.md R1, R14, R15; gate 12, sec. 4 punto 8.
--
-- ADITIVA: no toca ni una fila existente. Solo agrega columnas NULLABLE (sin default que reescriba
-- la tabla) y una tabla nueva. REUTILIZA `contactos.fuente_adquisicion` / `fuente_detalle` como
-- "fuente" del contacto; no los duplica. `empresas` no los tiene: recibe `origen_ref` para eso.
--
-- DRY-RUN: ejecutar ESTE archivo seguido de `do $$ begin raise exception 'DRY-RUN OK'; end $$;`
-- en una sola llamada: la excepción revierte todo. NO aplicar sin visto de Mauricio.
--
-- 1. Origen del dato (contactos y empresas). Todo opcional: las filas viejas quedan en null y
--    "sin base_legal declarada no se envía" (R1) las deja fuera del outbound.
alter table public.contactos
  add column if not exists origen_tipo text,
  add column if not exists origen_ref text,
  add column if not exists origen_capturado_at timestamptz,
  add column if not exists base_legal text,
  add column if not exists finalidad text,
  add column if not exists campana_origen text,
  add column if not exists aviso_version text;

alter table public.empresas
  add column if not exists origen_tipo text,
  add column if not exists origen_ref text,
  add column if not exists origen_capturado_at timestamptz,
  add column if not exists base_legal text,
  add column if not exists finalidad text,
  add column if not exists campana_origen text,
  add column if not exists aviso_version text;

do $$
declare t text;
begin
  foreach t in array array['contactos', 'empresas'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_base_legal_chk') then
      execute format($f$alter table public.%I add constraint %I check (base_legal is null or base_legal in
        ('autorizacion','dato_publico_rol','canal_corporativo_pj','relacion_existente','inbound')) not valid$f$,
        t, t || '_base_legal_chk');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_origen_tipo_chk') then
      execute format($f$alter table public.%I add constraint %I check (origen_tipo is null or origen_tipo in
        ('inbound_formulario','rues_certificado','sitio_web_empresa','referido_cliente','via_aliado','red_profesional','evento')) not valid$f$,
        t, t || '_origen_tipo_chk');
    end if;
  end loop;
end $$;

comment on column public.contactos.base_legal is
  'R1: autorizacion | dato_publico_rol | canal_corporativo_pj | relacion_existente | inbound. Sin base declarada no se envia outbound.';
comment on column public.contactos.origen_ref is
  'URL exacta o id del documento de donde salio el dato, y quien lo capturo.';

-- 2. Lista global de supresión. Guarda lo mínimo (R15): huella sha256 del correo / teléfono / NIT
--    normalizados (ver src/lib/supresion/), fecha, canal y motivo. NO se purga con las depuraciones.
-- server-only: la leen y escriben solo el helper y el script de bajas, con la llave de servicio.
create table if not exists public.supresiones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('email', 'telefono', 'nit')),
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  baja_at timestamptz not null default now(),
  canal text not null check (canal in ('email', 'whatsapp', 'telefono', 'formulario', 'verbal', 'rebote', 'otro')),
  motivo text not null default 'baja' check (motivo in ('baja', 'rebote_duro', 'queja', 'reclamo', 'otro')),
  campana text,
  registrado_por text,
  created_at timestamptz not null default now(),
  unique (tipo, huella)
);

comment on table public.supresiones is
  'Lista global de supresion (BAJA). Todo envio comercial la consulta antes de salir (estaSuprimido). '
  'Solo huellas, nunca el dato en claro. No se borra: ver trigger.';

alter table public.supresiones enable row level security;
revoke all on public.supresiones from anon, authenticated;

-- R15: la lista no se borra ni se edita. Corregir una baja mal cargada es decision humana por SQL
-- deshabilitando el trigger a proposito, no un efecto lateral de una depuracion.
create or replace function public.supresiones_inmutable()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  raise exception 'supresiones es append-only (R15): no se borra ni se edita';
end $$;

drop trigger if exists supresiones_inmutable on public.supresiones;
create trigger supresiones_inmutable
  before update or delete on public.supresiones
  for each row execute function public.supresiones_inmutable();

revoke execute on function public.supresiones_inmutable() from public, anon, authenticated;
