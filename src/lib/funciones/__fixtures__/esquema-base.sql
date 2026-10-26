-- Lo mínimo de ONE que necesitan `20261021090000_asistente_chatwoot.sql` y `20261022170000_modulo_funciones.sql`
-- para correr de verdad: roles de Supabase (`service_role` con BYPASSRLS, como allá), `auth.uid()`, workspaces,
-- perfiles, contactos y su guardián de teléfono, y las tres tablas cuyas listas de módulos reescribe la migración.
-- Lo usan `funciones-sql.test.ts` y `_shared/funciones/servicios.test.ts` (PGlite) y `scripts/funciones-concurrencia.sh`
-- (Postgres real en CI). No es una copia del esquema de producción: solo las columnas que estas migraciones tocan.

set time zone 'UTC';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
-- El default de Supabase: las funciones nacen ejecutables por los tres y las tablas nacen con todo para service_role.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.workspaces (id uuid primary key, slug text, modules jsonb default '{}'::jsonb);
create table public.profiles (id uuid primary key, workspace_id uuid references public.workspaces(id), role text);
create function public.current_user_workspace_id() returns uuid language sql stable security definer
  set search_path = public as
  $$ select workspace_id from public.profiles where id = auth.uid() $$;

create table public.contactos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  nombre text not null,
  telefono text,
  created_at timestamptz default now()
);
create function public.limpiar_telefono(t text) returns text language sql immutable as
  $$ select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '') $$;
create function public.telefono_valido(t text) returns boolean language sql immutable as
  $$ select t is null or t ~ '^[0-9]{7,15}$' $$;

create table public.workspace_modulos (id uuid primary key default gen_random_uuid(), workspace_id uuid, modulo text,
  constraint workspace_modulos_modulo check (modulo in ('business')));
create table public.catalogo_servicios (id uuid primary key default gen_random_uuid(), modulo text,
  constraint catalogo_servicios_modulo check (modulo in ('business')));
create table public.documentos_contractuales_versiones (id uuid primary key default gen_random_uuid(), modulo text,
  constraint documentos_versiones_modulo check (modulo in ('business')));
