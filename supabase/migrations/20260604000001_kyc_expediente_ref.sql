-- CCBF — cache local en ONE del estado de expedientes de Vinculacion de Contrapartes.
-- La fuente de verdad vive en metrik-valida (expedientes_kyc). ONE mantiene un espejo
-- (estado/etapa/severidad/decision) que se actualiza via webhook firmado (HMAC-SHA256).
--
-- Convencion DB de ONE (CLAUDE.md): RLS on + policy por workspace + grant explicito.
--   * Lectura: cliente authenticated (panel OC) -> policy por workspace + grant select.
--   * Escritura: solo el webhook (service_role bypasea RLS) -> sin policy ni grant de insert/update.

create table if not exists kyc_expediente_ref (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  expediente_kyc_id uuid not null unique,          -- id externo en metrik-valida
  razon_social      text,
  estado_cache      text not null,
  etapa_cache       text,
  severidad_cache   text,
  decision_cache    jsonb,
  actualizado_en    timestamptz not null default now(),
  creado_en         timestamptz not null default now()
);

create index if not exists idx_kyc_ref_workspace on kyc_expediente_ref(workspace_id, actualizado_en desc);

alter table kyc_expediente_ref enable row level security;

-- Lectura por workspace para el panel OC (cliente authenticated).
drop policy if exists kyc_ref_select on kyc_expediente_ref;
create policy kyc_ref_select on kyc_expediente_ref
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

grant select on kyc_expediente_ref to authenticated;
-- INSERT/UPDATE solo via service_role (webhook): sin grant ni policy adicionales.
