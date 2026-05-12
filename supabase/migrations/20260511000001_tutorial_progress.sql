-- Tutorial progress — Tracking de adopcion de tutoriales in-app por workspace+user
-- Reusable: tutorial_slug es enum-via-CHECK con valores conocidos. Agregar nuevos slugs
-- cuando se agreguen mas tutoriales (ver src/lib/tutorials/registry.ts).
-- Se crea row on-demand al primer paso: `current_step === 0 && row exists` significa
-- "vio el tour, abandono en step 0" vs `null` que es "nunca lo abrio".

-- =============================================================================
-- TABLA tutorial_progress
-- =============================================================================
create table if not exists tutorial_progress (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tutorial_slug text not null check (tutorial_slug in (
    'valida_standalone', 'valida_compliance', 'compliance_listas_dual'
  )),
  version int not null default 1,
  current_step int not null default 0,
  completed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, tutorial_slug)
);

create index if not exists idx_tutorial_progress_lookup
  on tutorial_progress (user_id, tutorial_slug);

-- =============================================================================
-- RLS
-- =============================================================================
alter table tutorial_progress enable row level security;

drop policy if exists tutorial_progress_select on tutorial_progress;
create policy tutorial_progress_select on tutorial_progress
  for select using (
    workspace_id = current_user_workspace_id() and user_id = auth.uid()
  );

drop policy if exists tutorial_progress_insert on tutorial_progress;
create policy tutorial_progress_insert on tutorial_progress
  for insert with check (
    workspace_id = current_user_workspace_id() and user_id = auth.uid()
  );

drop policy if exists tutorial_progress_update on tutorial_progress;
create policy tutorial_progress_update on tutorial_progress
  for update using (
    workspace_id = current_user_workspace_id() and user_id = auth.uid()
  );

drop policy if exists tutorial_progress_delete on tutorial_progress;
create policy tutorial_progress_delete on tutorial_progress
  for delete using (
    workspace_id = current_user_workspace_id() and user_id = auth.uid()
  );

-- =============================================================================
-- TRIGGER updated_at
-- =============================================================================
drop trigger if exists trg_tutorial_progress_updated_at on tutorial_progress;
create trigger trg_tutorial_progress_updated_at
  before update on tutorial_progress
  for each row execute function set_updated_at();

-- =============================================================================
-- VISTA v_tutorial_adopcion — KPI agregado por workspace+slug
-- =============================================================================
drop view if exists v_tutorial_adopcion;
create view v_tutorial_adopcion as
select
  workspace_id,
  tutorial_slug,
  count(*) filter (where current_step > 0) as iniciados,
  count(*) filter (where completed_at is not null) as completados,
  count(*) filter (where dismissed_at is not null) as descartados,
  round(
    100.0 * count(*) filter (where completed_at is not null) /
    nullif(count(*) filter (where current_step > 0), 0),
    1
  ) as tasa_completacion_pct
from tutorial_progress
group by workspace_id, tutorial_slug;

comment on table tutorial_progress is
  'Tracking de progreso de tutoriales in-app por workspace+user+slug. Row se crea on-demand al primer paso del usuario. completed_at se setea al terminar el tour, dismissed_at si el usuario lo cierra.';

comment on view v_tutorial_adopcion is
  'KPI de adopcion de tutoriales: iniciados, completados, descartados y tasa de completacion por workspace y slug.';

-- =============================================================================
-- Seed sanity-check para workspace AFI
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from workspaces
    where slug = 'afi' and (modules->>'valida_consulta')::boolean = true
  ) then
    raise notice 'Workspace AFI no tiene modules.valida_consulta activo. Tutorial valida_standalone no se mostrara hasta activarlo.';
  end if;
end $$;
