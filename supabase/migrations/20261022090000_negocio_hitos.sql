-- ============================================================================
-- Hitos de gestión del viaje (Trappvel, `noor-hana-hitos-de-gestion-2026-10-21.md` y la «Respuesta
-- de Edgar» del 2026-10-21; brief a Max del 2026-10-22).
--
-- Un hito es una fecha en la que una persona de la agencia hace una gestión por el viajero
-- (check-in, reconfirmar el hotel, detalles del tour…). Los hitos PENDIENTES no se guardan: los
-- calcula la aplicación cada vez desde las fechas de los servicios (`src/lib/viaje/hitos.ts`).
-- Esta tabla guarda solo lo que la persona CERRÓ: hecho, no aplica o no se hizo a tiempo, con quién,
-- cuándo, la nota y el adjunto (referencia `one://`, en el bucket que ya usan los vouchers).
--
-- La llave lleva la fecha del servicio de la que cuelga el hito (`fecha_objetivo`): si la fecha del
-- servicio cambia, la marca vieja deja de aplicar y el hito vuelve a estar pendiente.
--
-- SOLO ESQUEMA: no escribe ni corrige ninguna fila de datos. Idempotente: se puede correr dos veces.
-- Requiere la migración de fechas de los servicios (20261021120000, PR #1236) solo para tener
-- sentido funcional; el esquema de aquí no depende de sus columnas.
--
-- Partes:
--   1. Tabla `negocio_hitos` (RLS por workspace como `negocio_servicios`, grants explícitos)
--   2. Tipos nuevos de notificación: `agenda_del_dia` (resumen diario por persona) y
--      `hito_vencido` (un solo aviso a la dirección por hito). Se agregan a lo que haya vivo en la
--      base (lectura de pg_constraint), no a una lista copiada: otro PR que amplíe el mismo CHECK
--      (p. ej. #1153, `factura_electronica`) conserva lo suyo en cualquier orden.
-- ============================================================================

-- ── 1. negocio_hitos ─────────────────────────────────────────────────────────

create table if not exists public.negocio_hitos (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  -- Null en los hitos del viaje (pedir documentos, requisitos de entrada).
  servicio_id    uuid references public.negocio_servicios(id) on delete cascade,
  -- Tramo del vuelo (1, 2, …): el check-in es uno por tramo. Null en lo demás.
  tramo          integer check (tramo is null or tramo between 1 and 12),
  -- id del catálogo (`checkin_vuelo`, `reconfirmar_hotel`, …). El catálogo vive en el código y en
  -- `lineas_negocio.config_extra.hitos`: aquí no se cierra la lista para sumar hitos sin migración.
  hito_id        text not null check (hito_id ~ '^[a-z][a-z_]{2,39}$'),
  -- La fecha del servicio (o del tramo, o de la salida) de la que cuelga el hito, no el día del aviso.
  fecha_objetivo date not null,
  estado         text not null check (estado in ('hecho', 'no_aplica', 'no_se_hizo')),
  -- Pasabordo, voucher de la asistencia, comprobante del pre-registro: referencia `one://`.
  evidencia_ref  text check (evidencia_ref is null or (evidencia_ref like 'one://%' and length(evidencia_ref) <= 500)),
  -- Hora y punto de encuentro, quién confirmó y por dónde, o el motivo de «No aplica».
  nota           text check (nota is null or length(nota) <= 500),
  hecho_por      uuid references public.staff(id) on delete set null,
  hecho_at       timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- «No aplica» exige una línea de motivo (regla 5 del brief).
  constraint negocio_hitos_no_aplica_con_motivo
    check (estado <> 'no_aplica' or length(btrim(coalesce(nota, ''))) > 0),
  -- Una marca por hito y fecha. `nulls not distinct`: servicio y tramo nulos cuentan como iguales.
  constraint negocio_hitos_una_vez
    unique nulls not distinct (negocio_id, servicio_id, tramo, hito_id, fecha_objetivo)
);

create index if not exists idx_negocio_hitos_negocio on public.negocio_hitos (negocio_id);
create index if not exists idx_negocio_hitos_servicio on public.negocio_hitos (servicio_id) where servicio_id is not null;

alter table public.negocio_hitos enable row level security;
revoke all on table public.negocio_hitos from public, anon;

do $$
begin
  if not exists (
    select 1 from pg_policy
     where polname = 'negocio_hitos_ws' and polrelid = 'public.negocio_hitos'::regclass
  ) then
    create policy negocio_hitos_ws on public.negocio_hitos for all
      using (workspace_id = (select public.current_user_workspace_id()))
      with check (workspace_id = (select public.current_user_workspace_id()));
  end if;
end $$;

-- La agenda y las acciones de la app escriben con el cliente de sesión (RLS por workspace); el motor
-- de recordatorios lee con service_role.
grant select, insert, update, delete on public.negocio_hitos to authenticated, service_role;

comment on table public.negocio_hitos is
  'Hitos de gestión del viaje que alguien cerró (hecho / no_aplica / no_se_hizo). Los pendientes no se guardan: se calculan desde las fechas de negocio_servicios (src/lib/viaje/hitos.ts). fecha_objetivo = fecha del servicio de la que cuelga: si cambia, el hito vuelve a pendiente.';

-- ── 2. Tipos de notificación ─────────────────────────────────────────────────

-- Mismo método que la migración de F0 (20261012150000): se agregan a la definición VIVA, fallando
-- si la forma no es la esperada. No hace nada si ya están.
do $$
declare
  v_tabla constant regclass := 'public.notificaciones'::regclass;
  v_nuevos constant text[] := array['agenda_del_dia', 'hito_vencido'];
  v_def text;
  v_nueva text;
  v_valor text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'notificaciones_tipo_check' and conrelid = v_tabla;
  if v_def is null then
    raise exception 'negocio_hitos: no existe notificaciones_tipo_check; no se amplía a ciegas';
  end if;

  v_nueva := v_def;
  foreach v_valor in array v_nuevos loop
    if position(quote_literal(v_valor) in v_nueva) = 0 then
      v_nueva := regexp_replace(v_nueva, '\]\)\)\)$', format(', %s::text])))', quote_literal(v_valor)));
      if position(quote_literal(v_valor) in v_nueva) = 0 then
        raise exception 'negocio_hitos: forma inesperada de notificaciones_tipo_check: %', v_def;
      end if;
    end if;
  end loop;

  if v_nueva <> v_def then
    alter table public.notificaciones drop constraint notificaciones_tipo_check;
    execute format('alter table public.notificaciones add constraint notificaciones_tipo_check %s', v_nueva);
  end if;
end $$;
