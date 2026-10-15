-- =============================================================================
-- Cargue masivo de Valida procesado en el SERVIDOR (2026-10-15)
-- =============================================================================
--
-- Hasta hoy el navegador corría el lote: un server action por fila. Next encola los server actions
-- del cliente y los corre de a uno, así que el lote iba en serie (1,25–3,4 s por fila medidos en
-- 2.707 filas), con la puerta CDA resuelta ~3 veces por fila, y cerrar la pestaña lo cortaba.
--
-- Ahora el archivo se sube una vez, ONE guarda el lote y sus filas, y un trabajador del servidor
-- (cron de Vercel por minuto + `after()` al crear el lote) las procesa con concurrencia real:
--
--   * `valida_lotes`       el lote: estado, contadores, turno del trabajador y autorización.
--   * `valida_lote_filas`  una fila del XLSX: la entrada tal cual va a Valida y su resultado.
--
-- La cola es Postgres con `for update skip locked` (`valida_lote_reclamar_fila`). La equidad entre
-- espacios va por TURNOS (`valida_lote_tomar_turno`): a lo sumo N lotes a la vez, cada uno con un
-- turno corto, y el siguiente turno es para el lote que lleva más tiempo sin uno.
--
-- Idempotencia por fila, en dos capas:
--   1. `valida_consultas.lote_fila_id` es único: una fila nunca deja dos consultas en el historial;
--   2. la llamada a Valida lleva `Idempotency-Key` con el id de la fila: si un trabajador murió
--      después de que Valida cobró, el reintento recibe la misma respuesta sin cobrar otra vez.
--
-- Todo lo escribe el servidor con `service_role`. La sesión solo LEE (RLS por espacio).
--
-- NO se aplica sola. Orden: esta migración → merge (el código nuevo la necesita para el cargue
-- masivo; sin ella el cargue masivo falla a la vista, la consulta puntual sigue igual).
-- =============================================================================

-- ─── Lotes ─────────────────────────────────────────────────────────────────────

create table if not exists public.valida_lotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  titulo text check (titulo is null or char_length(titulo) <= 200),
  -- El negocio del lote entero (las filas sin `negocio_codigo` lo heredan).
  negocio_id uuid references public.negocios(id) on delete set null,
  estado text not null default 'preparando'
    check (estado in ('preparando', 'en_cola', 'procesando', 'pausado', 'completado', 'cancelado')),
  -- Por qué está pausado: bolsa_agotada | bolsa_vencida | reautorizar | acceso | sin_llave | valida_rechazo.
  motivo_pausa text,
  detalle_pausa text,
  total int not null default 0 check (total between 0 and 10000),
  -- Filas del archivo que NO entraron al lote porque la bolsa no alcanzaba (la persona lo aceptó).
  omitidas int not null default 0 check (omitidas >= 0),
  procesadas int not null default 0 check (procesadas >= 0),
  -- Conteo por severidad, con la misma regla de la pantalla de siempre ({"alto": 3, "error": 1, ...}).
  severidades jsonb not null default '{}'::jsonb,
  -- Filas a la vez para ESTE lote (null = la del servidor). Valida aguanta 20 por cliente.
  concurrencia int check (concurrencia is null or concurrencia between 1 and 20),
  -- Hasta cuándo vale la autorización que dio la sesión (la puerta CDA completa). Pasado el plazo, el
  -- trabajador pausa el lote con `reautorizar` hasta que alguien del espacio vuelva a la pantalla.
  autorizado_hasta timestamptz,
  -- Huella de los contratos de Valida del espacio al autorizar (`valida_lote_huella_acceso`). Si cambia
  -- a mitad del lote (contrato cancelado, terminado, plazo de términos), el trabajador pausa.
  huella_acceso text,
  -- Turno del trabajador que lo tiene: quién y hasta cuándo. Vencido, lo toma otro.
  trabajador uuid,
  turno_hasta timestamptz,
  ultimo_turno_at timestamptz,
  -- Última vez que la pantalla despertó un trabajador para este lote: a lo sumo uno por minuto.
  despertado_at timestamptz,
  aviso_enviado_at timestamptz,
  terminado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un solo lote corriendo por espacio: dos lotes a la vez se pisarían la bolsa y la cuota de Valida.
create unique index if not exists valida_lotes_uno_activo_por_espacio
  on public.valida_lotes (workspace_id)
  where estado in ('en_cola', 'procesando');

create index if not exists valida_lotes_cola
  on public.valida_lotes (ultimo_turno_at nulls first, created_at)
  where estado in ('en_cola', 'procesando');

create index if not exists valida_lotes_espacio_fecha
  on public.valida_lotes (workspace_id, created_at desc);

comment on table public.valida_lotes is
  'Cargue masivo de Valida procesado en el servidor (2026-10-15). Lo escribe solo service_role; la sesión lee lo de su espacio.';

-- ─── Filas ─────────────────────────────────────────────────────────────────────

create table if not exists public.valida_lote_filas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.valida_lotes(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  posicion int not null check (posicion >= 1),
  -- El cuerpo EXACTO que va a POST /api/v1/validate ({tipo, nombre?, documento?}).
  entrada jsonb not null,
  negocio_id uuid references public.negocios(id) on delete set null,
  -- La fila venía mal del XLSX (tipo inválido o sin nombre ni documento). Se procesa igual que antes.
  error_parseo text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_curso', 'hecha', 'error')),
  intentos int not null default 0 check (intentos >= 0),
  reclamada_hasta timestamptz,
  consulta_local_id uuid references public.valida_consultas(id) on delete set null,
  valida_consulta_id text,
  severidad text,
  total_matches int,
  resultado_error text,
  terminada_at timestamptz,
  constraint valida_lote_filas_posicion_unica unique (lote_id, posicion)
);

create index if not exists valida_lote_filas_por_hacer
  on public.valida_lote_filas (lote_id, posicion)
  where estado in ('pendiente', 'en_curso');

comment on table public.valida_lote_filas is
  'Filas de un cargue masivo de Valida. La cola del trabajador (for update skip locked). Lo escribe solo service_role.';

-- ─── La consulta del historial recuerda de qué fila salió ─────────────────────

alter table public.valida_consultas
  add column if not exists lote_fila_id uuid references public.valida_lote_filas(id) on delete set null;

-- Una fila de lote deja a lo sumo UNA consulta en el historial, aunque dos trabajadores la corran.
create unique index if not exists valida_consultas_lote_fila_unica
  on public.valida_consultas (lote_fila_id)
  where lote_fila_id is not null;

-- ─── RLS y permisos ────────────────────────────────────────────────────────────

alter table public.valida_lotes enable row level security;
alter table public.valida_lote_filas enable row level security;

revoke all on public.valida_lotes from anon, authenticated;
revoke all on public.valida_lote_filas from anon, authenticated;

-- La sesión solo lee lo de su espacio. Escribe únicamente el servidor (service_role, sin RLS).
grant select on public.valida_lotes to authenticated;
grant select on public.valida_lote_filas to authenticated;

drop policy if exists valida_lotes_select on public.valida_lotes;
create policy valida_lotes_select on public.valida_lotes
  for select to authenticated
  using (workspace_id = (select public.current_user_workspace_id()));

drop policy if exists valida_lote_filas_select on public.valida_lote_filas;
create policy valida_lote_filas_select on public.valida_lote_filas
  for select to authenticated
  using (workspace_id = (select public.current_user_workspace_id()));

-- ─── Turno de un lote (equidad entre espacios) ─────────────────────────────────
--
-- Un trabajador pide turno. Se lo dan si hay menos de `p_max_simultaneos` lotes con turno vigente, y
-- es para el lote activo que lleva MÁS tiempo sin turno (`ultimo_turno_at`, nulos primero: un lote
-- recién creado entra adelante). El candado consultivo serializa los pedidos para que dos
-- trabajadores no pasen el tope a la vez.

create or replace function public.valida_lote_tomar_turno(
  p_trabajador uuid,
  p_turno_s int,
  p_max_simultaneos int
)
returns setof public.valida_lotes
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ocupados int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('valida_lotes_turno'));

  select count(*) into v_ocupados
    from public.valida_lotes
   where estado = 'procesando' and turno_hasta > now();
  if v_ocupados >= p_max_simultaneos then
    return;
  end if;

  select id into v_id
    from public.valida_lotes
   where estado in ('en_cola', 'procesando')
     and (turno_hasta is null or turno_hasta <= now())
   order by ultimo_turno_at asc nulls first, created_at asc
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;

  return query
  update public.valida_lotes
     set estado = 'procesando',
         trabajador = p_trabajador,
         turno_hasta = now() + make_interval(secs => p_turno_s),
         ultimo_turno_at = now(),
         updated_at = now()
   where id = v_id
  returning *;
end;
$$;

-- server-only: solo el trabajador (service_role) reparte turnos.
revoke execute on function public.valida_lote_tomar_turno(uuid, int, int) from public, anon, authenticated;
grant execute on function public.valida_lote_tomar_turno(uuid, int, int) to service_role;

-- ─── Reclamar UNA fila (la cola) ───────────────────────────────────────────────
--
-- La siguiente fila por posición: pendiente, o en curso con el reclamo vencido (su trabajador murió).
-- Solo para quien tiene el turno del lote, y solo con el lote procesando: un lote pausado o cancelado
-- no entrega más filas aunque el trabajador siga vivo.

create or replace function public.valida_lote_reclamar_fila(
  p_lote uuid,
  p_trabajador uuid,
  p_reclamo_s int
)
returns setof public.valida_lote_filas
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.valida_lotes l
     where l.id = p_lote and l.estado = 'procesando' and l.trabajador = p_trabajador
  ) then
    return;
  end if;

  select f.id into v_id
    from public.valida_lote_filas f
   where f.lote_id = p_lote
     and (f.estado = 'pendiente' or (f.estado = 'en_curso' and f.reclamada_hasta <= now()))
   order by f.posicion
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;

  return query
  update public.valida_lote_filas
     set estado = 'en_curso',
         intentos = intentos + 1,
         reclamada_hasta = now() + make_interval(secs => p_reclamo_s)
   where id = v_id
  returning *;
end;
$$;

-- server-only: solo el trabajador (service_role) reclama filas.
revoke execute on function public.valida_lote_reclamar_fila(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.valida_lote_reclamar_fila(uuid, uuid, int) to service_role;

-- ─── Terminar una fila y sumar al lote, en una sola transacción ────────────────
--
-- Solo cuenta si la fila seguía EN CURSO: si dos trabajadores la terminan (reclamo vencido), suma una
-- vez. `p_severidad_conteo` es la del contador de la pantalla (una fila mal escrita cuenta como error,
-- como siempre); `p_severidad` es la que quedó en el historial.

create or replace function public.valida_lote_fila_terminar(
  p_fila uuid,
  p_estado text,
  p_severidad text,
  p_severidad_conteo text,
  p_consulta_local_id uuid,
  p_valida_consulta_id text,
  p_total_matches int,
  p_error text
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_lote uuid;
begin
  if p_estado not in ('hecha', 'error') then
    raise exception 'estado de fila no terminal: %', p_estado;
  end if;

  update public.valida_lote_filas
     set estado = p_estado,
         severidad = p_severidad,
         consulta_local_id = p_consulta_local_id,
         valida_consulta_id = p_valida_consulta_id,
         total_matches = p_total_matches,
         resultado_error = p_error,
         reclamada_hasta = null,
         terminada_at = now()
   where id = p_fila and estado = 'en_curso'
  returning lote_id into v_lote;
  if v_lote is null then
    return false;
  end if;

  update public.valida_lotes
     set procesadas = procesadas + 1,
         severidades = jsonb_set(
           severidades,
           array[p_severidad_conteo],
           to_jsonb(coalesce((severidades ->> p_severidad_conteo)::int, 0) + 1)
         ),
         updated_at = now()
   where id = v_lote;
  return true;
end;
$$;

-- server-only: solo el trabajador (service_role) termina filas.
revoke execute on function public.valida_lote_fila_terminar(uuid, text, text, text, uuid, text, int, text) from public, anon, authenticated;
grant execute on function public.valida_lote_fila_terminar(uuid, text, text, text, uuid, text, int, text) to service_role;

-- ─── Cerrar el turno ───────────────────────────────────────────────────────────
--
-- Suelta el turno y, si no queda ninguna fila por hacer, da el lote por completado. Devuelve el estado
-- del lote, o null si el turno ya no era de este trabajador (lo pausaron o lo cancelaron entretanto).

create or replace function public.valida_lote_cerrar_turno(p_lote uuid, p_trabajador uuid)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_quedan boolean;
  v_estado text;
begin
  select exists (
    select 1 from public.valida_lote_filas
     where lote_id = p_lote and estado in ('pendiente', 'en_curso')
  ) into v_quedan;

  update public.valida_lotes
     set estado = case when estado = 'procesando' and not v_quedan then 'completado' else estado end,
         terminado_at = case when estado = 'procesando' and not v_quedan then now() else terminado_at end,
         trabajador = null,
         turno_hasta = null,
         updated_at = now()
   where id = p_lote and trabajador = p_trabajador
  returning estado into v_estado;
  return v_estado;
end;
$$;

-- server-only: solo el trabajador (service_role) cierra turnos.
revoke execute on function public.valida_lote_cerrar_turno(uuid, uuid) from public, anon, authenticated;
grant execute on function public.valida_lote_cerrar_turno(uuid, uuid) to service_role;

-- ─── Huella de los contratos de Valida del espacio ─────────────────────────────
--
-- Lo que la puerta CDA mira de los contratos y que puede cambiar a mitad de un lote: cuáles hay, su
-- estado, su vigencia y el plazo para aceptar términos. Vacía para un espacio sin contrato (AFI,
-- metrik, el registro autogestionado): ahí la puerta no aplica. El trabajador la compara en cada turno
-- con la que se guardó al autorizar; distinta, el lote se pausa hasta que la sesión vuelva a autorizar.

create or replace function public.valida_lote_huella_acceso(p_workspace uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(md5(string_agg(
           sc.id::text || ':' || sc.estado || ':' || coalesce(sc.vigente_hasta::text, '') || ':' ||
           coalesce(sc.terminos_plazo_hasta::text, ''),
           '|' order by sc.id)), '')
    from public.servicios_contratados sc
    join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
   where cs.modulo = 'valida_consulta'
     and (
       sc.workspace_pagador_id = p_workspace
       or exists (
         select 1 from public.servicio_contratado_beneficiarios b
          where b.servicio_contratado_id = sc.id and b.workspace_id = p_workspace
       )
     );
$$;

-- server-only: la calcula el servidor con service_role al autorizar y en cada turno.
revoke execute on function public.valida_lote_huella_acceso(uuid) from public, anon, authenticated;
grant execute on function public.valida_lote_huella_acceso(uuid) to service_role;
