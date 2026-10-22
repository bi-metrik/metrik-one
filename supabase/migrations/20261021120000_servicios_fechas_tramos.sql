-- ============================================================================
-- Fechas completas, corregibles y consultables en los servicios del viaje (Trappvel, base de
-- los hitos de gestión: `noor-hana-hitos-de-gestion-2026-10-21.md` §4.2).
--
-- Regla de Hana: la fecha se lee de la cotización, se corrige en la fila y nunca se pide
-- aparte. Si no se leyó, queda vacía («Falta la fecha»).
--
-- SOLO ESQUEMA. No escribe ni corrige ninguna fila: las filas ya generadas ganan las fechas
-- desde su ítem por la aplicación (`completarFechasDeServicios`), al abrir el tablero o al
-- traer los servicios, y nunca pisan lo corregido a mano. Idempotente: se puede correr dos veces.
--
-- Partes:
--   1. negocio_servicios: fin, horas, tramos del vuelo, marca de lectura y de corrección a mano
--   2. CHECK: fin ≥ inicio, forma de los tramos, corrección con fecha
--   3. Índice para «servicios cuyo inicio cae en tal ventana»
--   4. Vista plana `negocio_servicio_fechas` (security_invoker): un renglón por tramo, inicio y fin
-- ============================================================================

-- ── 1. Columnas ──────────────────────────────────────────────────────────────

alter table public.negocio_servicios
  -- El fin del servicio: check-out del hotel, último tramo del vuelo. Null = un solo día o sin leer.
  add column if not exists fecha_fin             date,
  add column if not exists hora_inicio           time,
  add column if not exists hora_fin              time,
  -- Solo vuelos: cada tramo en el orden del viaje. Un vuelo redondo sigue siendo UNA fila (así se
  -- cotiza y se paga; partirlo rompería el cuadre de costo F0-2). Forma en la parte 2.
  add column if not exists tramos                jsonb,
  -- Cuándo se derivaron las fechas de la lectura del ítem. Null en las filas anteriores a esta
  -- migración: la aplicación las completa una vez y pone la marca.
  add column if not exists fechas_leidas_at      timestamptz,
  -- Quién y cuándo corrigió las fechas a mano. Con la marca, ninguna regeneración las pisa.
  add column if not exists fechas_corregidas_por uuid references public.staff(id) on delete set null,
  add column if not exists fechas_corregidas_at  timestamptz;

comment on column public.negocio_servicios.tramos is
  'Vuelos: [{fecha AAAA-MM-DD, hora_salida HH:MM, hora_llegada HH:MM, origen, destino, aerolinea, numero_vuelo}] en orden. fecha_servicio = primer tramo; fecha_fin = último. Consulta plana: vista negocio_servicio_fechas.';
comment on column public.negocio_servicios.fechas_corregidas_at is
  'Fechas corregidas a mano en la hoja de la fila. Con esto puesto, ni la generación ni el completado tocan fecha_servicio, fecha_fin, horas ni tramos.';

-- ── 2. Reglas de la fila ─────────────────────────────────────────────────────

-- Forma de los tramos. Inmutable de verdad (make_date, sin DateStyle): la usa un CHECK y la vista
-- castea `fecha` y las horas sin miedo a una fila rota.
create or replace function public.negocio_servicios_tramos_validos(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  t jsonb;
  f text;
  h text;
  campo text;
begin
  if p is null then
    return true;
  end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 12 then
    return false;
  end if;
  for t in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(t) <> 'object' then
      return false;
    end if;
    -- Un tramo sin fecha no es un tramo: la fecha que falta se ve como «Falta la fecha».
    if jsonb_typeof(t -> 'fecha') is distinct from 'string' then
      return false;
    end if;
    f := t ->> 'fecha';
    if f !~ '^\d{4}-\d{2}-\d{2}$' then
      return false;
    end if;
    begin
      perform make_date(substr(f, 1, 4)::int, substr(f, 6, 2)::int, substr(f, 9, 2)::int);
    exception when others then
      return false;
    end;
    foreach campo in array array['hora_salida', 'hora_llegada'] loop
      if t ? campo and jsonb_typeof(t -> campo) <> 'null' then
        h := t ->> campo;
        if jsonb_typeof(t -> campo) <> 'string' or h !~ '^([01]\d|2[0-3]):[0-5]\d$' then
          return false;
        end if;
      end if;
    end loop;
    foreach campo in array array['origen', 'destino', 'aerolinea', 'numero_vuelo'] loop
      if t ? campo and jsonb_typeof(t -> campo) <> 'null' then
        if jsonb_typeof(t -> campo) <> 'string' or length(t ->> campo) > 100 then
          return false;
        end if;
      end if;
    end loop;
  end loop;
  return true;
end
$$;

revoke all on function public.negocio_servicios_tramos_validos(jsonb) from public, anon;
grant execute on function public.negocio_servicios_tramos_validos(jsonb) to authenticated, service_role;

do $$
begin
  -- Todas las filas vivas tienen fecha_fin null: el CHECK no falla con datos de hoy.
  if not exists (
    select 1 from pg_constraint
     where conname = 'negocio_servicios_fin_tras_inicio' and conrelid = 'public.negocio_servicios'::regclass
  ) then
    alter table public.negocio_servicios add constraint negocio_servicios_fin_tras_inicio
      check (fecha_fin is null or (fecha_servicio is not null and fecha_fin >= fecha_servicio));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'negocio_servicios_tramos_forma' and conrelid = 'public.negocio_servicios'::regclass
  ) then
    alter table public.negocio_servicios add constraint negocio_servicios_tramos_forma
      check (public.negocio_servicios_tramos_validos(tramos));
  end if;

  -- Quién sin cuándo no se puede (el «quién» sí puede faltar: on delete set null del staff).
  if not exists (
    select 1 from pg_constraint
     where conname = 'negocio_servicios_correccion_con_fecha' and conrelid = 'public.negocio_servicios'::regclass
  ) then
    alter table public.negocio_servicios add constraint negocio_servicios_correccion_con_fecha
      check (fechas_corregidas_por is null or fechas_corregidas_at is not null);
  end if;
end $$;

-- ── 3. Índice ────────────────────────────────────────────────────────────────

-- Lo que pediría la fuente «servicio» del motor: los servicios vivos cuyo inicio cae en una
-- ventana (`fecha_servicio <= hasta and coalesce(fecha_fin, fecha_servicio) >= desde`).
create index if not exists idx_negocio_servicios_inicio
  on public.negocio_servicios (workspace_id, fecha_servicio)
  where estado <> 'cancelado' and fecha_servicio is not null;

-- ── 4. Vista plana ───────────────────────────────────────────────────────────

-- Un renglón por momento del servicio: cada tramo del vuelo (`ancla = 'tramo'`), el inicio y el
-- fin. Quien pide «vuelos con un tramo mañana» filtra `ancla = 'tramo'`; «hoteles con check-in
-- en 3 días», `ancla = 'inicio'`.
--
-- ⚠️ `create or replace view` SIN el `with (security_invoker = on)` lo borra y la vista pasa a
-- leer con los permisos del dueño (salta la RLS). Se declara aquí y se reafirma abajo.
create or replace view public.negocio_servicio_fechas
  with (security_invoker = on)
as
select
  s.id                         as servicio_id,
  s.workspace_id,
  s.negocio_id,
  s.tipo,
  s.estado,
  s.nombre,
  s.responsable_staff_id,
  'tramo'::text                as ancla,
  t.n::integer                 as tramo,
  (t.e ->> 'fecha')::date      as fecha,
  (t.e ->> 'hora_salida')::time  as hora,
  (t.e ->> 'hora_llegada')::time as hora_llegada,
  t.e ->> 'origen'             as origen,
  t.e ->> 'destino'            as destino,
  t.e ->> 'aerolinea'          as aerolinea,
  t.e ->> 'numero_vuelo'       as numero_vuelo,
  s.fechas_corregidas_at
from public.negocio_servicios s
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(s.tramos) = 'array' then s.tramos else '[]'::jsonb end
) with ordinality as t(e, n)
union all
select
  s.id, s.workspace_id, s.negocio_id, s.tipo, s.estado, s.nombre, s.responsable_staff_id,
  'inicio'::text, null::integer, s.fecha_servicio, s.hora_inicio, null::time,
  null::text, null::text, null::text, null::text, s.fechas_corregidas_at
from public.negocio_servicios s
where s.fecha_servicio is not null
union all
select
  s.id, s.workspace_id, s.negocio_id, s.tipo, s.estado, s.nombre, s.responsable_staff_id,
  'fin'::text, null::integer, s.fecha_fin, s.hora_fin, null::time,
  null::text, null::text, null::text, null::text, s.fechas_corregidas_at
from public.negocio_servicios s
where s.fecha_fin is not null;

alter view public.negocio_servicio_fechas set (security_invoker = on);
revoke all on public.negocio_servicio_fechas from public, anon;
grant select on public.negocio_servicio_fechas to authenticated, service_role;

comment on view public.negocio_servicio_fechas is
  'Fechas de los servicios del viaje, planas: un renglón por tramo (ancla=tramo), inicio y fin. security_invoker: respeta la RLS por workspace de negocio_servicios. Base de la futura fuente «servicio» del motor de recordatorios.';
