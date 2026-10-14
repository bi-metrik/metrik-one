-- ============================================================================
-- F2 · Plan de pagos del viajero (post-cotización, PR 6). SOLO ESQUEMA.
--
-- Diseño técnico §2.1-2.2 y Vera §2 C2, §6 F2, §7.2. El plan de pagos de una venta única de
-- viaje NO va en `planes_cobro`: ese es el cobro recurrente de MéTRIK (frecuencia, cuentas de
-- cobro, enlaces Bold, renovación) y su cron generaría cobros uniformes para un plan a medias.
--
--   · Compromiso = cuota del plan `acordado`. Plata = `cobros` con `fecha` (pagos reales).
--   · Las cuotas NO se guardan como cobros programados (Vera §7.2.3): ningún cron del cobro
--     recurrente toca el plan del viaje, y el saldo no se infla.
--   · Cada cambio de cuotas es una VERSIÓN nueva (§2.3 bis): la anterior queda `reemplazado` y se
--     ve en el historial. Un solo plan `acordado` por negocio (índice único parcial, §7.2.1).
--   · Fuera de la regla 80/15, el plan pide aprobación (`aprobaciones_excepcion`, tipo
--     `plan_fuera_de_regla`, ya creada por #1111) y no se puede acordar sin ella. Eso lo revisa el
--     servidor al acordar, con la huella de las cuotas (F2-3); aquí solo queda la referencia.
--   · `cobros.cuenta_recaudo`: a qué cuenta entró el pago del viajero (id de
--     `workspaces.config_extra.cuentas_recaudo`). Define la forma de pago del recibo (F2-6).
--
-- No escribe ni corrige ninguna fila de ningún workspace. Todo lo que se construye encima queda
-- detrás de `lineas_negocio.config_extra.plan_pagos.activo` (ausente = apagado = como hoy).
-- ============================================================================

-- ── 1. Planes (una fila por versión) ─────────────────────────────────────────

-- Lo lee y escribe la sesión (`authenticated`) por workspace; quién puede cambiar el plan
-- (comercial dueña o aprobadores, Vera §7.4) lo revisan las acciones del servidor.
create table public.negocio_planes_pago (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  negocio_id       uuid not null references public.negocios(id) on delete cascade,
  -- La cotización con la que se propuso. Una cotización duplicada arranca plan nuevo.
  cotizacion_id    uuid references public.cotizaciones(id) on delete set null,
  version          integer not null check (version >= 1),
  estado           text not null default 'propuesta'
                   check (estado in ('propuesta', 'acordado', 'reemplazado', 'anulado')),
  origen           text not null check (origen in ('sugerido', 'ajustado')),
  total            numeric(15, 2) not null check (total > 0),
  -- La fecha de salida con que se calculó: si la salida cambia, el plan queda desfasado y pide
  -- versión nueva (no se recalcula solo: el cliente aceptó esas fechas).
  fecha_referencia date,
  -- Copia de la regla con que se midió: {"pct_minimo":80,"dias_antes":15,"anticipo_pct":30}.
  regla            jsonb not null check (jsonb_typeof(regla) = 'object'),
  dentro_de_regla  boolean not null,
  aprobacion_id    uuid references public.aprobaciones_excepcion(id) on delete set null,
  -- Por qué cambió esta versión (texto llano de quien la guardó: «el cliente pidió 4 cuotas»).
  motivo           text check (motivo is null or length(motivo) <= 500),
  acordado_at      timestamptz,
  acordado_por     uuid references public.staff(id) on delete set null,
  -- Anulado (prerreserva vencida, C9; negocio perdido): cuándo y por qué.
  anulado_at       timestamptz,
  anulado_motivo   text,
  created_by       uuid references public.staff(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint negocio_planes_pago_version_unica unique (negocio_id, version),
  -- Un plan acordado dice cuándo y quién; uno fuera de regla solo se acuerda con su aprobación.
  constraint negocio_planes_pago_acordado_con_fecha
    check (estado <> 'acordado' or acordado_at is not null),
  constraint negocio_planes_pago_fuera_de_regla_aprobado
    check (estado <> 'acordado' or dentro_de_regla or aprobacion_id is not null),
  constraint negocio_planes_pago_anulado_con_motivo
    check (estado <> 'anulado' or length(btrim(coalesce(anulado_motivo, ''))) > 0)
);

-- Un solo plan acordado por negocio (Vera §7.2.1).
create unique index negocio_planes_pago_un_acordado
  on public.negocio_planes_pago (negocio_id) where estado = 'acordado';
create index idx_negocio_planes_pago_negocio on public.negocio_planes_pago (negocio_id, version desc);

alter table public.negocio_planes_pago enable row level security;
revoke all on table public.negocio_planes_pago from public, anon;
create policy negocio_planes_pago_ws on public.negocio_planes_pago for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
grant select, insert, update, delete on public.negocio_planes_pago to authenticated;

comment on table public.negocio_planes_pago is
  'Plan de pagos del viajero (F2 post-cotización). Una fila por versión; un solo acordado por negocio. Las cuotas son compromisos: la plata va en cobros con fecha, nunca como cobros programados.';

-- ── 2. Cuotas del plan ───────────────────────────────────────────────────────

create table public.negocio_plan_cuotas (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  plan_id           uuid not null references public.negocio_planes_pago(id) on delete cascade,
  -- 0 = anticipo (al confirmar); 1..n en orden de vencimiento.
  numero            integer not null check (numero >= 0),
  monto             numeric(15, 2) not null check (monto > 0),
  fecha_vencimiento date not null,
  concepto          text check (concepto is null or length(concepto) <= 200),
  constraint negocio_plan_cuotas_numero_unico unique (plan_id, numero)
);

create index idx_negocio_plan_cuotas_plan on public.negocio_plan_cuotas (plan_id, fecha_vencimiento);
-- Lo que lee el motor de recordatorios (fuente `cuota`, PR 9) por workspace y fecha.
create index idx_negocio_plan_cuotas_vencimiento
  on public.negocio_plan_cuotas (workspace_id, fecha_vencimiento);

alter table public.negocio_plan_cuotas enable row level security;
revoke all on table public.negocio_plan_cuotas from public, anon;
create policy negocio_plan_cuotas_ws on public.negocio_plan_cuotas for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
grant select, insert, update, delete on public.negocio_plan_cuotas to authenticated;

comment on table public.negocio_plan_cuotas is
  'Cuotas de una versión del plan de pagos del viajero. El estado de cada cuota (pagada, en parte, vencida) se deriva por FIFO contra cobros.fecha; no se guarda.';

-- ── 3. A qué cuenta entró el pago ────────────────────────────────────────────

alter table public.cobros add column if not exists cuenta_recaudo text
  check (cuenta_recaudo is null or length(btrim(cuenta_recaudo)) between 1 and 60);

comment on column public.cobros.cuenta_recaudo is
  'Cuenta que recibió el pago: id de workspaces.config_extra.cuentas_recaudo. Decide la forma de pago del recibo de caja (F2). Null = como hoy.';
