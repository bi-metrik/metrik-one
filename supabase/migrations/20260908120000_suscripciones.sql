-- ============================================================
-- 20260908120000 — Suscripciones de licencia ONE (Fase 1: modelo + pasarela manual)
-- Spec: docs/specs/2026-09-08_suscripciones-cobro-automatico.md
--
-- Qué existe hoy (medido en producción el 2026-09-08): las licencias se cobran como
-- negocios del cliente dentro del workspace `metrik`, con `planes_cobro` (10 planes,
-- los 10 con pasarela = 'manual', 9 activos, todos mensuales) y cuentas de cobro de
-- persona natural que emite el cron `procesar-planes-cobro` desde el día 10.
-- `workspaces.subscription_status` existe desde el schema inicial y NADIE la lee:
-- 12 workspaces en 'trial', 4 en 'active', 1 en 'active_pro', ninguno con
-- `subscription_expires_at`.
--
-- Qué agrega esto — solo DDL, ninguna fila se inserta ni se reescribe:
--   1. `suscripciones`: una fila por workspace CLIENTE, apuntando al plan de cobro
--      que vive en el workspace del COBRADOR. Es lo que el ciclo de cobro lee y
--      escribe; el estado se PROYECTA en `workspaces.subscription_status`, que es lo
--      que el layout de la app consulta en cada render para decidir si deja entrar.
--   2. `planes_cobro.pasarela` acepta 'bold' y 'epayco'. La decisión de pasarela está
--      abierta; el CHECK no la toma, solo deja de estorbar.
--
-- Qué NO hace, a propósito: no crea suscripciones (las crea una persona, con el
-- `proximo_cobro` de la siguiente cuota sin pagar), no toca el vocabulario heredado de
-- `subscription_status` (el gate solo reacciona a 'suspendida'; 'trial', 'active' y
-- 'active_pro' pasan igual que hoy), y no suspende a nadie. Un workspace sin fila en
-- `suscripciones` no cambia en nada.
-- ============================================================

-- ── 1. suscripciones ─────────────────────────────────────────────────────────

create table if not exists public.suscripciones (
  id                  uuid primary key default gen_random_uuid(),
  -- El cliente: el workspace cuyo acceso se gobierna. Una suscripción por workspace.
  workspace_id        uuid not null unique references public.workspaces(id) on delete cascade,
  -- El plan que la cobra, en el workspace del cobrador (hoy `metrik`). Único también:
  -- dos suscripciones sobre el mismo plan cobrarían la misma cuota dos veces.
  -- `restrict`: un plan con suscripción viva no se borra sin decidir qué pasa con ella.
  plan_cobro_id       uuid not null unique references public.planes_cobro(id) on delete restrict,
  pasarela            text not null default 'manual'
                        check (pasarela in ('manual', 'bold', 'epayco')),
  -- Medio de pago ENMASCARADO (marca, últimos 4, referencia del token). Nunca el
  -- número completo ni el CVV: el CHECK rechaza las claves que nadie debería intentar
  -- guardar aquí. Ver `MedioPagoEnmascarado` en src/lib/suscripciones/pasarela/adapter.ts.
  medio_pago          jsonb
                        check (
                          medio_pago is null
                          or (
                            jsonb_typeof(medio_pago) = 'object'
                            and not (medio_pago ? 'pan')
                            and not (medio_pago ? 'numero')
                            and not (medio_pago ? 'cvv')
                            and not (medio_pago ? 'cvc')
                          )
                        ),
  estado              text not null default 'trial'
                        check (estado in ('trial', 'activa', 'pendiente_pago', 'suspendida', 'cancelada')),
  -- Fecha (Bogotá) de la próxima cuota a cobrar. El cron corre el ciclo cuando
  -- `proximo_cobro <= hoy`. NULL = el plan terminó (o nadie la ha configurado).
  proximo_cobro       date,
  intentos_fallidos   integer not null default 0 check (intentos_fallidos >= 0),
  ultimo_error        text,
  estado_cambiado_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.suscripciones is
  'Suscripción de licencia ONE: una por workspace cliente, cobrada por un plan_cobro del workspace cobrador. Estado canónico de la relación comercial; se proyecta en workspaces.subscription_status para el gate de acceso. La escriben el cron procesar-planes-cobro (ciclo) y el platform admin; el cliente solo la lee.';
comment on column public.suscripciones.workspace_id is 'Workspace del CLIENTE (el que paga). UNIQUE: una suscripción por workspace.';
comment on column public.suscripciones.plan_cobro_id is 'Plan de cobro en el workspace del COBRADOR. UNIQUE: un plan cobra una sola suscripción.';
comment on column public.suscripciones.pasarela is 'manual (Fase 1: se confirma el pago a mano) | bold (link de pago por cuota + webhook) | epayco (cargo por token, débito sin clic).';
comment on column public.suscripciones.medio_pago is 'Medio de pago enmascarado: {tipo, marca, ultimos4, titular, token_ref, pasarela}. NUNCA PAN ni CVV.';
comment on column public.suscripciones.estado is 'trial → activa → pendiente_pago → suspendida → cancelada. Máquina en src/lib/suscripciones/estado.ts. cancelada es terminal; suspendida se reactiva con el pago.';
comment on column public.suscripciones.proximo_cobro is 'Fecha Bogotá de la próxima cuota. El cron corre el ciclo cuando <= hoy. La aritmética es la de src/lib/cobros/fecha-cuota.ts (la misma del paso 1 del cron).';
comment on column public.suscripciones.intentos_fallidos is 'Cargos rechazados seguidos. Vuelve a 0 con cada pago recibido.';

-- Lo que el cron pregunta cada día.
create index if not exists idx_suscripciones_ciclo
  on public.suscripciones (estado, proximo_cobro)
  where proximo_cobro is not null;

-- updated_at. Función propia y sin privilegios para nadie: PostgreSQL no exige
-- EXECUTE para DISPARAR un trigger, solo para crearlo (medido 2026-08-11).
create or replace function public.suscripciones_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke execute on function public.suscripciones_set_updated_at() from public, anon, authenticated;

drop trigger if exists trg_suscripciones_updated_at on public.suscripciones;
create trigger trg_suscripciones_updated_at
  before update on public.suscripciones
  for each row execute function public.suscripciones_set_updated_at();

-- RLS: el cliente puede VER su propia suscripción (estado, próximo cobro, medio de
-- pago enmascarado) para una futura pantalla "Mi suscripción". No puede escribirla:
-- el estado lo mueve la plata, no el cliente. Escritura solo con service_role
-- (cron y platform admin), que salta RLS.
alter table public.suscripciones enable row level security;

drop policy if exists suscripciones_lee_su_workspace on public.suscripciones;
create policy suscripciones_lee_su_workspace on public.suscripciones
  for select
  using (workspace_id = (select public.current_user_workspace_id()));

grant select on public.suscripciones to authenticated;

-- ── 2. planes_cobro.pasarela: bold y epayco ──────────────────────────────────
-- Los 10 planes vivos están en 'manual' (medido 2026-09-08): re-crear el CHECK no
-- rechaza ninguna fila.
alter table public.planes_cobro drop constraint if exists planes_cobro_pasarela_check;
alter table public.planes_cobro add constraint planes_cobro_pasarela_check
  check (pasarela in ('wompi', 'manual', 'mixto', 'bold', 'epayco'));

comment on column public.planes_cobro.pasarela is
  'wompi | manual | mixto (heredados) | bold | epayco. Para licencias, la pasarela efectiva es la de suscripciones.pasarela; aquí queda por compatibilidad con BloquePlanRecurrente.';
