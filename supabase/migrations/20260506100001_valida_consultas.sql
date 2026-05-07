-- Valida — Historico de consultas dentro de ONE
-- Almacena resumen de cada consulta a metrik-valida para que el workspace tenga
-- trazabilidad local + filtro por negocio. Multi-tenant via workspace_id + RLS.

-- =============================================================================
-- TABLA valida_consultas
-- =============================================================================
create table if not exists valida_consultas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  negocio_id uuid references negocios(id) on delete set null,
  lote_id uuid,
  tipo text not null check (tipo in ('puntual', 'masiva_item')),
  -- Datos de la consulta
  tipo_persona text not null check (tipo_persona in ('natural', 'juridica')),
  nombre_consultado text,
  documento_tipo text,
  documento_numero text,
  -- Resultado
  valida_consulta_id text,
  severidad text not null check (severidad in ('alto', 'medio', 'bajo', 'informativo', 'sin_hallazgo', 'error')),
  total_matches int not null default 0,
  matches jsonb,
  hash_reporte text,
  -- Auditoria
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists idx_valida_consultas_workspace_fecha
  on valida_consultas(workspace_id, created_at desc);

create index if not exists idx_valida_consultas_negocio
  on valida_consultas(workspace_id, negocio_id, created_at desc)
  where negocio_id is not null;

create index if not exists idx_valida_consultas_lote
  on valida_consultas(workspace_id, lote_id)
  where lote_id is not null;

create index if not exists idx_valida_consultas_severidad
  on valida_consultas(workspace_id, severidad, created_at desc);

-- =============================================================================
-- RLS
-- =============================================================================
alter table valida_consultas enable row level security;

drop policy if exists valida_consultas_select on valida_consultas;
create policy valida_consultas_select on valida_consultas
  for select using (workspace_id = current_user_workspace_id());

drop policy if exists valida_consultas_insert on valida_consultas;
create policy valida_consultas_insert on valida_consultas
  for insert with check (workspace_id = current_user_workspace_id());

drop policy if exists valida_consultas_update on valida_consultas;
create policy valida_consultas_update on valida_consultas
  for update using (workspace_id = current_user_workspace_id());

-- =============================================================================
-- ACTIVAR MODULO valida_consulta EN WORKSPACE AFI
-- =============================================================================
-- Slug del workspace AFI (workflow CDAs). Si no existe, no hace nada.
update workspaces
set modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object('valida_consulta', true)
where slug = 'afi';

comment on table valida_consultas is
  'Historial local de consultas a Valida. Cada workspace ve solo las suyas via RLS. Las consultas remotas siguen viviendo en metrik-valida; aqui solo guardamos resumen + asociacion opcional a negocio.';
