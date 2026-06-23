-- Panel de conciliación de pagos — F2 SOENA
--
-- Resuelve 3 casuísticas de Diana (financiera SOENA):
--   1. Un pago cubre VARIOS negocios (split): se reparte UN pago entre N negocios
--      SIN duplicar el monto. Cada porción es un cobro independiente que apunta al
--      MISMO `external_ref` pero marcado como split deliberado en `cobros.split_json`.
--   2. Pago por debajo (saldo pendiente) — ya resuelto por F1 (no se toca aquí).
--   3. Sobrepago — ya resuelto por gate `sobrepago_conciliado` (no se toca aquí).
--
-- El gate `conciliacion_diana` bloquea el avance de etapa de un negocio hasta que
-- su diferencia (precio - cobrado) sea 0 Y Diana dé el check (fila conciliada en
-- `negocio_conciliacion`). Es OPT-IN por etapa (config_extra.gates) → otros
-- workspaces sin el gate no cambian.
--
-- Retrocompatible: agrega 1 columna nullable + 1 tabla nueva. Nada existente cambia.

-- ── 1. cobros.split_json — marca de reparto deliberado ───────────────────────────
--
-- Cuando un pago se reparte entre varios negocios desde el panel de conciliación,
-- cada cobro de la porción lleva en split_json:
--   { "split_id": "<uuid>", "split_total": <monto bruto del pago>, "split_n": <#negocios> }
-- El split_id agrupa todas las porciones de un mismo pago. La detección de
-- duplicados de F3 (buscarReferenciaDuplicada) reconoce un cobro con split_id como
-- split sancionado y NO lo trata como duplicado accidental de external_ref.
alter table public.cobros
  add column if not exists split_json jsonb;

comment on column public.cobros.split_json is
  'Reparto deliberado de un pago entre varios negocios (panel de conciliación F2). '
  '{split_id, split_total, split_n}. Un cobro con split_id es un split sancionado, '
  'no un duplicado accidental de external_ref.';

-- Índice para resolver rápido "¿qué cobros pertenecen a este split?"
create index if not exists idx_cobros_split_id
  on public.cobros ((split_json ->> 'split_id'))
  where split_json is not null;

-- ── 2. negocio_conciliacion — el check de Diana por negocio ──────────────────────
--
-- Una fila por negocio conciliado. Es la fuente de verdad del "check de Diana" que
-- alimenta el gate `conciliacion_diana`. Se inserta/actualiza solo desde el panel
-- (área financiera). El gate exige: diferencia == 0 (calculada en vivo) Y
-- conciliado == true en esta tabla.
create table if not exists public.negocio_conciliacion (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  negocio_id    uuid not null references public.negocios(id) on delete cascade,
  conciliado    boolean not null default false,
  conciliado_por uuid references public.staff(id),
  conciliado_at timestamptz,
  nota          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (negocio_id)
);

comment on table public.negocio_conciliacion is
  'Check de conciliación de Diana (financiera) por negocio. Alimenta el gate '
  'conciliacion_diana: el negocio no avanza de etapa hasta diferencia=0 + este check.';

create index if not exists idx_negocio_conciliacion_ws
  on public.negocio_conciliacion (workspace_id);

-- RLS + aislamiento por workspace + grant (la consume el cliente authenticated en
-- el panel de conciliación).
alter table public.negocio_conciliacion enable row level security;

drop policy if exists negocio_conciliacion_select on public.negocio_conciliacion;
create policy negocio_conciliacion_select on public.negocio_conciliacion
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

drop policy if exists negocio_conciliacion_insert on public.negocio_conciliacion;
create policy negocio_conciliacion_insert on public.negocio_conciliacion
  for insert to authenticated
  with check (workspace_id = current_user_workspace_id());

drop policy if exists negocio_conciliacion_update on public.negocio_conciliacion;
create policy negocio_conciliacion_update on public.negocio_conciliacion
  for update to authenticated
  using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

grant select, insert, update, delete on public.negocio_conciliacion to authenticated;
