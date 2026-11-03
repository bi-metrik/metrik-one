-- Plantillas editables de documentos (DJ, Relación de facturas…) — 2026-10-29.
--
-- Tres tablas:
--   · plantillas_documento_editores: quién puede editar, por workspace. Lista EXPLÍCITA de
--     personas, no un rol. Se mantiene por SQL (sin deploy): ver la spec
--     docs/specs/2026-10-29_plantillas-editables.md.
--   · plantillas_documento_versiones: cada guardado es una versión NUEVA e inmutable
--     (sin UPDATE ni DELETE para nadie con sesión).
--   · plantillas_documento_activas: una fila por (workspace, tipo) que apunta a la versión
--     activa. Activar = un upsert de una sola fila, así que nunca hay dos activas.
--
-- Sin fila en `plantillas_documento_activas`, el documento sale con el componente
-- @react-pdf de siempre: esta migración no cambia ningún documento de ningún workspace.
--
-- Escritura: la server action verifica la lista Y el RLS la vuelve a exigir (una persona
-- con sesión que no esté en la lista no puede insertar aunque llame a PostgREST directo).

-- ── Editores ────────────────────────────────────────────────────────────────
create table if not exists public.plantillas_documento_editores (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  nota text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

comment on table public.plantillas_documento_editores is
  'Personas que pueden editar y activar las plantillas de documentos del workspace. Lista explícita, se mantiene por SQL.';

alter table public.plantillas_documento_editores enable row level security;

drop policy if exists plantillas_editores_select on public.plantillas_documento_editores;
create policy plantillas_editores_select on public.plantillas_documento_editores
  for select to authenticated
  using (workspace_id = public.current_user_workspace_id());

-- Solo lectura con sesión: la lista se cambia por SQL (service role), nunca desde la app.
grant select on public.plantillas_documento_editores to authenticated;

-- ── Versiones ───────────────────────────────────────────────────────────────
create table if not exists public.plantillas_documento_versiones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tipo text not null check (tipo ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  version_n integer not null check (version_n > 0),
  contenido text not null check (char_length(contenido) between 1 and 50000),
  nota text check (nota is null or char_length(nota) <= 300),
  creada_por uuid references public.profiles(id) on delete set null,
  creada_por_nombre text,
  restaurada_de uuid references public.plantillas_documento_versiones(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, tipo, version_n),
  -- Destino de la llave compuesta de `plantillas_documento_activas`.
  unique (id, workspace_id, tipo)
);

comment on table public.plantillas_documento_versiones is
  'Versiones inmutables de las plantillas editables de documentos. Guardar crea una versión nueva.';

create index if not exists plantillas_documento_versiones_ws_tipo
  on public.plantillas_documento_versiones (workspace_id, tipo, version_n desc);

alter table public.plantillas_documento_versiones enable row level security;

drop policy if exists plantillas_versiones_select on public.plantillas_documento_versiones;
create policy plantillas_versiones_select on public.plantillas_documento_versiones
  for select to authenticated
  using (workspace_id = public.current_user_workspace_id());

drop policy if exists plantillas_versiones_insert on public.plantillas_documento_versiones;
create policy plantillas_versiones_insert on public.plantillas_documento_versiones
  for insert to authenticated
  with check (
    workspace_id = public.current_user_workspace_id()
    and creada_por = auth.uid()
    and exists (
      select 1 from public.plantillas_documento_editores e
      where e.workspace_id = plantillas_documento_versiones.workspace_id
        and e.user_id = auth.uid()
    )
  );

-- Sin UPDATE ni DELETE: una versión no se sobreescribe nunca.
grant select, insert on public.plantillas_documento_versiones to authenticated;

-- ── Activa ──────────────────────────────────────────────────────────────────
create table if not exists public.plantillas_documento_activas (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tipo text not null,
  version_id uuid not null,
  activada_por uuid references public.profiles(id) on delete set null,
  activada_at timestamptz not null default now(),
  primary key (workspace_id, tipo),
  -- La versión activa es del MISMO workspace y del MISMO tipo.
  foreign key (version_id, workspace_id, tipo)
    references public.plantillas_documento_versiones (id, workspace_id, tipo)
);

comment on table public.plantillas_documento_activas is
  'Versión activa de cada plantilla editable por workspace. Sin fila = el documento sale con el formato de fábrica.';

alter table public.plantillas_documento_activas enable row level security;

drop policy if exists plantillas_activas_select on public.plantillas_documento_activas;
create policy plantillas_activas_select on public.plantillas_documento_activas
  for select to authenticated
  using (workspace_id = public.current_user_workspace_id());

drop policy if exists plantillas_activas_insert on public.plantillas_documento_activas;
create policy plantillas_activas_insert on public.plantillas_documento_activas
  for insert to authenticated
  with check (
    workspace_id = public.current_user_workspace_id()
    and activada_por = auth.uid()
    and exists (
      select 1 from public.plantillas_documento_editores e
      where e.workspace_id = plantillas_documento_activas.workspace_id
        and e.user_id = auth.uid()
    )
  );

drop policy if exists plantillas_activas_update on public.plantillas_documento_activas;
create policy plantillas_activas_update on public.plantillas_documento_activas
  for update to authenticated
  using (
    workspace_id = public.current_user_workspace_id()
    and exists (
      select 1 from public.plantillas_documento_editores e
      where e.workspace_id = plantillas_documento_activas.workspace_id
        and e.user_id = auth.uid()
    )
  )
  with check (
    workspace_id = public.current_user_workspace_id()
    and activada_por = auth.uid()
    and exists (
      select 1 from public.plantillas_documento_editores e
      where e.workspace_id = plantillas_documento_activas.workspace_id
        and e.user_id = auth.uid()
    )
  );

-- Sin DELETE: volver al formato de fábrica es una decisión de MéTRIK (SQL), no de la pantalla.
grant select, insert, update on public.plantillas_documento_activas to authenticated;
