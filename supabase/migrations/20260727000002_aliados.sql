-- ============================================================
-- aliados — directorio de contrapartes comerciales por workspace
-- ------------------------------------------------------------
-- Un ALIADO es una contraparte comercial con acuerdo (típicamente una empresa,
-- ej. "PROPES" en SOENA) que origina o acompaña negocios. Sirve para marcar
-- negocios de tipo "alianza".
--
-- NO es un promotor. `promoters` (módulo /promotores) modela a la persona que
-- refiere y gana comisión: otra entidad del negocio, con otro ciclo de vida.
-- Decisión de producto (Mauricio, 2026-07-27): son entidades SEPARADAS.
--
-- Genérica del producto, gateada por `workspaces.modules.aliados`.
--
-- Multi-tenant: RLS por workspace (patrón current_user_workspace_id()).
-- La consume el cliente authenticated (UI /directorio/aliados + server actions),
-- por eso: RLS on + policy por workspace + grant a authenticated.
-- El permiso fino de ESCRITURA (owner, o supervisor del área comercial) vive en
-- el guard server-side de la app (src/lib/permissions/can-edit.ts →
-- canGestionarAliados); RLS solo garantiza el aislamiento entre workspaces.
-- ============================================================

create table if not exists public.aliados (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  nombre          text not null,
  -- Identificación tributaria de la contraparte (sin DV pegado, ver src/lib/dian/nit.ts).
  nit             text,
  -- Persona de contacto del aliado (texto libre: el aliado no es un contacto del directorio).
  contacto_nombre text,
  email           text,
  telefono        text,
  estado          text not null default 'activo' check (estado in ('activo', 'inactivo')),
  notas           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id)
);

alter table public.aliados enable row level security;

-- Aislamiento por workspace (patrón canónico). Lectura + escritura del cliente
-- authenticated; la restricción por rol/área la aplica el guard de la app.
drop policy if exists aliados_rw on public.aliados;
create policy aliados_rw on public.aliados
  for all to authenticated
  using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

grant select, insert, update, delete on public.aliados to authenticated;

-- Una tabla nueva hereda privilegios de `anon` por default privilege del schema, y
-- la anon key viaja en el bundle del browser. Se revoca explícito para que un
-- entorno limpio nazca igual que prod (donde ya se revocó a mano).
revoke all on public.aliados from anon;

-- Listado del directorio y selector de aliados activos.
create index if not exists idx_aliados_workspace
  on public.aliados (workspace_id);

drop trigger if exists trg_aliados_updated_at on public.aliados;
create trigger trg_aliados_updated_at
  before update on public.aliados
  for each row execute function set_updated_at();

-- ============================================================
-- ROLLBACK (correr manualmente si hay que revertir):
--
-- drop trigger if exists trg_aliados_updated_at on public.aliados;
-- drop index if exists public.idx_aliados_workspace;
-- drop policy if exists aliados_rw on public.aliados;
-- drop table if exists public.aliados;
-- ============================================================
