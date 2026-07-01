-- Cronograma explícito de un plan de cobro: una fila por pago (anticipo + cuotas),
-- con monto y fecha de vencimiento exactos del contrato.
--
-- Motivación: planes_cobro asume cuotas mensuales uniformes con vencimiento día 15.
-- No modela anticipo, fecha de cuota distinta al 15, ni ajuste de centavos en la última
-- cuota (Trappvel: anticipo $1.000.000 + 5×$833.333 + 1×$833.335, en día calendario del contrato).
--
-- Retrocompat: un plan SIN filas aquí conserva el comportamiento actual del generador
-- (día 15, monto uniforme). Solo los planes CON cronograma explícito emiten por fecha/monto exactos.

create table if not exists public.plan_cobro_cuotas (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  plan_cobro_id     uuid not null references public.planes_cobro(id) on delete cascade,
  numero            integer not null,                    -- 0 = anticipo, 1..N = cuotas
  tipo              text not null default 'cuota' check (tipo in ('anticipo','cuota')),
  monto             numeric not null check (monto > 0),
  fecha_vencimiento date not null,
  concepto_detalle  text,                                -- opcional; si null, el generador usa el template del plan
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (plan_cobro_id, numero)
);

create index if not exists idx_plan_cobro_cuotas_plan on public.plan_cobro_cuotas(plan_cobro_id);
create index if not exists idx_plan_cobro_cuotas_venc on public.plan_cobro_cuotas(workspace_id, fecha_vencimiento);

alter table public.plan_cobro_cuotas enable row level security;

-- Aislamiento por workspace (consumida por el cliente authenticated en /cobros-recurrentes)
drop policy if exists plan_cobro_cuotas_ws_isolation on public.plan_cobro_cuotas;
create policy plan_cobro_cuotas_ws_isolation on public.plan_cobro_cuotas
  for all
  using (workspace_id = public.current_user_workspace_id())
  with check (workspace_id = public.current_user_workspace_id());

grant select, insert, update, delete on public.plan_cobro_cuotas to authenticated;
