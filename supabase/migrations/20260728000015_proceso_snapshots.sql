-- Foto periodica del proceso: cuantos negocios abiertos hay en cada etapa.
--
-- Por que una tabla y no una consulta: el conteo de HOY se calcula en vivo desde
-- `negocios`, pero el de la semana pasada no existe en ningun lado. `etapa_historial`
-- esta vacia y apunta a `oportunidad_id` (del modulo pipeline extirpado), y
-- `activity_log` solo guarda el NOMBRE de la etapa, que ya cambio con el renombre del
-- 2026-07-28. Sin esta tabla no hay forma de responder "la semana pasada teniamos 30".
--
-- Generico ONE: se llena para toda linea activa de todo workspace. El volumen es
-- despreciable (una fila por etapa por semana).
--
-- Decision (Mauricio, 2026-07-28): la serie arranca vacia y se llena hacia adelante.
-- Se descarto reconstruir el pasado desde activity_log: los renombres de etapa harian
-- que las semanas previas mostraran datos que nadie puede validar.

create table if not exists public.proceso_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  linea_id uuid not null references public.lineas_negocio(id) on delete cascade,
  etapa_id uuid not null references public.etapas_negocio(id) on delete cascade,
  -- El nombre y el orden se congelan al momento de la foto: si la etapa se renombra
  -- o se reordena despues, la serie historica sigue contando lo que se vio ese dia.
  etapa_nombre text not null,
  etapa_orden integer not null,
  stage text,
  abiertos integer not null default 0,
  vencidos integer not null default 0,
  sla_horas integer,
  tomado_en date not null default (now() at time zone 'America/Bogota')::date,
  created_at timestamptz not null default now(),
  -- Idempotencia: si el cron corre dos veces el mismo dia, la segunda actualiza.
  unique (workspace_id, etapa_id, tomado_en)
);

create index if not exists idx_proceso_snapshots_lookup
  on public.proceso_snapshots (workspace_id, linea_id, tomado_en desc);

alter table public.proceso_snapshots enable row level security;

-- La escribe el cron (postgres/service_role, que bypasea RLS); la lee el cliente
-- authenticated, acotado a su propio workspace.
drop policy if exists proceso_snapshots_select on public.proceso_snapshots;
create policy proceso_snapshots_select on public.proceso_snapshots
  for select to authenticated
  using (workspace_id = public.current_user_workspace_id());

-- El REVOKE va ANTES del GRANT y es obligatorio: en esta instancia las tablas nuevas
-- nacen con TODOS los privilegios para `anon` y `authenticated` por un default
-- privilege del schema, al reves de lo que dice la convencion. Verificado al aplicar:
-- sin este revoke, `authenticated` conservaba INSERT/UPDATE/DELETE/TRUNCATE y podia
-- falsear el historico (RLS lo frenaba, pero quedaba una sola capa de defensa).
revoke all on public.proceso_snapshots from anon, authenticated;
grant select on public.proceso_snapshots to authenticated;

comment on table public.proceso_snapshots is
  'Foto semanal de cuantos negocios abiertos hay por etapa. Alimenta la vista de evolucion del proceso. La llena el cron tomar_proceso_snapshot().';


-- ── Toma de la foto ────────────────────────────────────────────────────────────
-- Reusa exactamente la misma definicion de "vencido" que v_negocios_etapa_vencimiento
-- (horas habiles contra el sla_horas de la etapa), para que el historico y el badge
-- en vivo nunca cuenten distinto.
create or replace function public.tomar_proceso_snapshot()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas integer;
begin
  insert into public.proceso_snapshots (
    workspace_id, linea_id, etapa_id, etapa_nombre, etapa_orden, stage,
    abiertos, vencidos, sla_horas, tomado_en
  )
  select
    v.workspace_id,
    v.linea_id,
    v.etapa_id,
    v.etapa_nombre,
    v.etapa_orden,
    en.stage,
    v.abiertos,
    v.vencidos,
    v.sla_horas,
    (now() at time zone 'America/Bogota')::date
  from public.v_negocios_etapa_vencimiento v
  join public.etapas_negocio en on en.id = v.etapa_id
  where v.workspace_id is not null
    and en.is_active
  on conflict (workspace_id, etapa_id, tomado_en) do update
    set abiertos = excluded.abiertos,
        vencidos = excluded.vencidos,
        sla_horas = excluded.sla_horas,
        etapa_nombre = excluded.etapa_nombre,
        etapa_orden = excluded.etapa_orden,
        stage = excluded.stage;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke all on function public.tomar_proceso_snapshot() from anon, authenticated;

comment on function public.tomar_proceso_snapshot is
  'Inserta la foto del dia (una fila por etapa activa con negocios). Idempotente por dia. La dispara pg_cron los lunes.';


-- ── Cron: lunes a las 11:00 UTC (6:00 en Colombia) ─────────────────────────────
-- Antes de que arranque la operacion, para que la foto refleje como quedo la semana
-- que cerro. Es el dato que Juan David mira en su reunion de los lunes.
select cron.unschedule('tomar-proceso-snapshot')
  where exists (select 1 from cron.job where jobname = 'tomar-proceso-snapshot');

select cron.schedule(
  'tomar-proceso-snapshot',
  '0 11 * * 1',
  $cron$select public.tomar_proceso_snapshot();$cron$
);

-- Primera foto de inmediato: sin esto la serie arranca sin punto de partida.
select public.tomar_proceso_snapshot();
