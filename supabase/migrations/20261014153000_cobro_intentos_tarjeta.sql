-- ============================================================
-- 20261014153000 — Intentos de cobro con la tarjeta guardada, uno por día del calendario de mora
--
-- Decisión de Mauricio (2026-10-14), con el calendario de Carmen
-- (`proyectos/metrik/valida/docs/crecimiento-mrr/28-carmen-piso-epayco-y-gracia.md` §2.3) para el plan
-- de Valida en autoservicio, de la cuota 2 en adelante:
--   día 0 (vence la cuota): cobro con la tarjeta; si se rechaza, correo con enlace de pago;
--   días 3 y 7: reintento con la tarjeta;
--   día 7: aviso de suspensión;  día 10: suspensión (`DIAS_GRACIA_CICLO`).
-- El primer cobro (cuota 1) no se reintenta: Condiciones 7.5 y Términos 3.6.
--
-- ## Qué escribe: DDL de UNA tabla nueva. Ni una fila de datos.
--
-- Una fila por (plan, cuota, intento): 0 = día 0, 1 = día 3, 2 = día 7. La llave única es la guarda contra el
-- doble cargo: el cron INSERTA la fila antes de llamar a ePayco, y si dos corridas llegan a la vez, la
-- segunda choca con la llave y no cobra. Después se le escribe el resultado.
--
-- `cobro_id` sin llave foránea a propósito: la evidencia de un cargo a una tarjeta no se borra en
-- cascada si alguien borra o anula el cobro.
--
-- ## Reversa
--   drop table if exists public.cobro_intentos_tarjeta;
-- ============================================================

create table if not exists public.cobro_intentos_tarjeta (
  id uuid primary key default gen_random_uuid(),
  -- El espacio que cobra (metrik): el mismo `workspace_id` del cobro.
  workspace_id uuid not null,
  cobro_id uuid not null,
  plan_cobro_id uuid not null,
  numero_cuota integer not null,
  intento smallint not null check (intento between 0 and 2),
  resultado text not null default 'en_curso'
    check (resultado in ('en_curso', 'aprobado', 'pendiente', 'rechazado', 'error', 'no_aplica')),
  -- Referencia de la transacción en la pasarela, si la dio (`epayco-<ref_payco>`).
  referencia text,
  mensaje text check (mensaje is null or length(mensaje) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Por cuota y no por cobro: aunque una corrida cree otra fila de cobro para la misma cuota, el
  -- intento de ese día es uno solo.
  constraint cobro_intentos_tarjeta_uno_por_dia unique (plan_cobro_id, numero_cuota, intento)
);

create index if not exists cobro_intentos_tarjeta_cobro on public.cobro_intentos_tarjeta (cobro_id);

alter table public.cobro_intentos_tarjeta enable row level security;

-- server-only: la escriben y la leen solo el cron (`procesar-planes-cobro`, pasos 6 y 7b) y el cobro
-- tras la prueba, con service_role. Nadie con sesión la lee: no tiene policy.
revoke all on public.cobro_intentos_tarjeta from anon, authenticated;
grant all on public.cobro_intentos_tarjeta to service_role;
