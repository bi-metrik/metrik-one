-- 20260617000001_formulario_versiones.sql
-- Trazabilidad de versiones de formularios generados (010, 1668, etc.).
-- Cada vez que se genera/regenera un formulario queda una versión con su snapshot
-- de casillas, fecha y autor. La última versión "reposa" en ONE (pedido de Juan):
-- permite auditar qué se envió a la DIAN y, a futuro, medir tiempos de respuesta.
-- Genérico del producto (lo consumen 010/1668 de SOENA y cualquier formulario).

create table if not exists public.formulario_versiones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  negocio_bloque_id uuid not null references public.negocio_bloques(id) on delete cascade,
  version_n integer not null,
  drive_url text,
  -- Snapshot de las casillas tal como se generó el PDF (autollenado + overrides).
  datos_snapshot jsonb not null default '{}'::jsonb,
  generated_by uuid references public.profiles(id),
  generated_at timestamptz not null default now(),
  unique (negocio_bloque_id, version_n)
);

alter table public.formulario_versiones enable row level security;

-- Aislamiento por workspace (la tabla tiene workspace_id propio).
drop policy if exists formulario_versiones_workspace on public.formulario_versiones;
create policy formulario_versiones_workspace on public.formulario_versiones
  for all
  using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

-- La generación corre con el cliente authenticated (server action con guard de rol);
-- lectura para la lista de versiones en el bloque.
grant select, insert on public.formulario_versiones to authenticated;

create index if not exists idx_formulario_versiones_bloque
  on public.formulario_versiones (negocio_bloque_id, version_n desc);
