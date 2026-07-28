-- Modulo calidad_llamadas — auditoria de llamadas de call center.
--
-- Multi-cliente dentro de ONE (no a la medida de un workspace). Se activa con
-- workspaces.modules.calidad_llamadas. Prefijo `calidad_` en las 5 tablas para
-- poder retirarlo de un tiro si la linea no prospera.
--
-- Dos ejes que NO se promedian:
--   - tecnica: puntaje 0-100, desglosado en 7 bloques.
--   - cumplimiento: semaforo + banderas ancladas a un segundo de la grabacion.
--
-- Reglas de acceso (ver convencion en CLAUDE.md):
--   calidad_llamadas / _bloques / _hallazgos / calidad_cobertura_dia
--     → cliente `authenticated`: RLS + policy por current_user_workspace_id() + GRANT SELECT.
--   calidad_dinero_cuotas
--     → SOLO server-side (createServiceClient). RLS ON, SIN policy y SIN grant.
--       Poner un grant aqui filtraria la plata a cualquiera con la anon key del bundle.

-- ── 1. Llamadas ─────────────────────────────────────────────────────────────
--
-- OJO: esta tabla NO tiene columna con el nombre del cliente final. Solo
-- `cliente_ref`, un identificador opaco. Es una garantia del modelo de datos,
-- no una regla de UI: el muro es publico por enlace y la transcripcion trae
-- datos personales sensibles. Si alguien necesita el nombre, tiene que cambiar
-- el esquema — la friccion es deliberada.
create table if not exists public.calidad_llamadas (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  cliente_ref       text not null,
  fecha_hora        timestamptz not null,
  direccion         text not null default 'entrante' check (direccion in ('entrante', 'saliente')),
  duracion_seg      integer not null check (duracion_seg >= 0),
  -- FK a staff(id), nunca a profiles(id). NULL = agente sin cuenta en el
  -- workspace (los rellenos de demostracion) → un ejecutor jamas los ve, por
  -- construccion, porque su filtro es `agente_staff_id = <su staff.id>`.
  agente_staff_id   uuid references public.staff(id) on delete set null,
  agente_nombre     text not null,
  puntaje_tecnico   integer not null check (puntaje_tecnico between 0 and 100),
  semaforo          text not null check (semaforo in ('verde', 'amarillo', 'rojo')),
  habla_agente_pct  numeric(5,1),
  habla_cliente_pct numeric(5,1),
  turnos            integer,
  repreguntas       integer,
  monologos_45s     integer,
  -- true = tiene bloques + hallazgos con cita y segundo (pantalla de detalle completa).
  detalle_completo  boolean not null default false,
  -- false = dato de demostracion. Se rotula de forma permanente en la UI.
  es_real           boolean not null default false,
  -- Lote de carga. El seed borra su lote antes de insertar (idempotencia).
  lote              text,
  created_at        timestamptz not null default now()
);

alter table public.calidad_llamadas enable row level security;

create policy calidad_llamadas_select on public.calidad_llamadas
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

grant select on public.calidad_llamadas to authenticated;

create index if not exists idx_calidad_llamadas_ws         on public.calidad_llamadas(workspace_id);
create index if not exists idx_calidad_llamadas_ws_fecha   on public.calidad_llamadas(workspace_id, fecha_hora desc);
create index if not exists idx_calidad_llamadas_ws_agente  on public.calidad_llamadas(workspace_id, agente_staff_id);
create index if not exists idx_calidad_llamadas_lote       on public.calidad_llamadas(workspace_id, lote);

-- ── 2. Bloques del eje tecnica ──────────────────────────────────────────────
-- Grano: bloque × llamada (7 por llamada con detalle completo).
-- Invariante: sum(puntaje) por llamada == calidad_llamadas.puntaje_tecnico.
create table if not exists public.calidad_llamadas_bloques (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  llamada_id   uuid not null references public.calidad_llamadas(id) on delete cascade,
  orden        integer not null,
  nombre       text not null,
  puntaje      integer not null check (puntaje >= 0),
  puntaje_max  integer not null check (puntaje_max > 0),
  created_at   timestamptz not null default now(),
  unique (llamada_id, orden)
);

alter table public.calidad_llamadas_bloques enable row level security;

create policy calidad_llamadas_bloques_select on public.calidad_llamadas_bloques
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

grant select on public.calidad_llamadas_bloques to authenticated;

create index if not exists idx_calidad_bloques_llamada on public.calidad_llamadas_bloques(llamada_id, orden);

-- ── 3. Hallazgos del eje cumplimiento ───────────────────────────────────────
--
-- Una bandera anclada a un segundo de la grabacion. `hecho` y `titulo` se
-- enuncian SIEMPRE como hecho verificable con minuto, nunca como calificacion
-- juridica (ver memo legal de Emilio, 2026-07-27). `cita` es textual.
-- `eje` distingue las banderas de cumplimiento de los eventos de contexto que
-- solo alimentan la cinta temporal.
create table if not exists public.calidad_llamadas_hallazgos (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  llamada_id   uuid not null references public.calidad_llamadas(id) on delete cascade,
  eje          text not null default 'cumplimiento' check (eje in ('cumplimiento', 'tecnica')),
  -- NULL para los eventos de contexto (no levantan bandera).
  codigo       text,
  severidad    text check (severidad in ('critica', 'alta', 'media')),
  titulo       text not null,
  hecho        text,
  cita         text,
  -- Segundo exacto dentro de la grabacion. Es lo que ancla la cinta temporal.
  segundo      integer not null check (segundo >= 0),
  -- Referencia legible al turno de la transcripcion, cuando aplica ("7 y 9", "17-22").
  turno_ref    text,
  created_at   timestamptz not null default now()
);

alter table public.calidad_llamadas_hallazgos enable row level security;

create policy calidad_llamadas_hallazgos_select on public.calidad_llamadas_hallazgos
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

grant select on public.calidad_llamadas_hallazgos to authenticated;

create index if not exists idx_calidad_hallazgos_llamada on public.calidad_llamadas_hallazgos(llamada_id, segundo);
create index if not exists idx_calidad_hallazgos_ws_cod  on public.calidad_llamadas_hallazgos(workspace_id, codigo);

-- ── 4. Cobertura por dia ────────────────────────────────────────────────────
-- Recibidas vs auditadas. Sin esto no se puede pintar la cobertura del muro
-- (el numero heroe: 100% hoy contra el 5% que se audita a mano).
create table if not exists public.calidad_cobertura_dia (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  fecha             date not null,
  recibidas         integer not null default 0 check (recibidas >= 0),
  auditadas         integer not null default 0 check (auditadas >= 0),
  -- Cuantas se auditaban a mano ese dia. Es el contrafactual del argumento.
  baseline_manual   integer not null default 0 check (baseline_manual >= 0),
  created_at        timestamptz not null default now(),
  unique (workspace_id, fecha)
);

alter table public.calidad_cobertura_dia enable row level security;

create policy calidad_cobertura_dia_select on public.calidad_cobertura_dia
  for select to authenticated
  using (workspace_id = current_user_workspace_id());

grant select on public.calidad_cobertura_dia to authenticated;

create index if not exists idx_calidad_cobertura_ws_fecha on public.calidad_cobertura_dia(workspace_id, fecha desc);

-- ── 5. Dinero por cuota — TABLA SENSIBLE ────────────────────────────────────
--
-- RLS habilitado, SIN policy y SIN grant: no es legible por `anon` ni por
-- `authenticated` bajo ninguna circunstancia. Se lee unicamente server-side con
-- createServiceClient() desde /calidad/dueno, que ademas guarda por rol owner.
-- Si algun dia aparece un `grant ... to authenticated` aqui, es un bug: expone
-- lo vendido y lo recaudado a cualquiera con la anon key (que va en el bundle).
create table if not exists public.calidad_dinero_cuotas (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  cuota          integer not null check (cuota between 1 and 24),
  ventas         integer not null default 0,
  vendido_usd    numeric(12,2) not null default 0,
  recaudado_usd  numeric(12,2) not null default 0,
  created_at     timestamptz not null default now(),
  unique (workspace_id, cuota)
);

alter table public.calidad_dinero_cuotas enable row level security;

-- Intencionalmente sin policy y sin grant. No borrar este comentario.

create index if not exists idx_calidad_dinero_ws on public.calidad_dinero_cuotas(workspace_id, cuota);

-- ── RPC del muro proyectable ────────────────────────────────────────────────
--
-- Devuelve el jsonb del muro. NO incluye `cliente_ref` ni ninguna columna
-- monetaria: el muro vive en un televisor que ve todo el piso e incluso
-- visitas. Si alguien quiere meter dinero o el identificador del cliente al
-- muro, tiene que cambiar esta funcion. La friccion es deliberada.
--
-- Los agentes salen por NOMBRE DE PILA. El muro es publico por enlace: en el
-- piso todos se conocen, en internet un nombre de pila no identifica a nadie.
--
-- `security invoker`: llamada por service_role (muro publico sin sesion)
-- devuelve el workspace pedido; llamada por un authenticated de otro workspace
-- devuelve vacio, porque el RLS de las tablas base lo filtra.
create or replace function public.get_calidad_muro(
  p_workspace_id uuid,
  p_fecha        date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with dia as (
    select * from calidad_cobertura_dia
    where workspace_id = p_workspace_id and fecha = p_fecha
  ),
  llamadas_dia as (
    select * from calidad_llamadas
    where workspace_id = p_workspace_id and fecha_hora::date = p_fecha
  )
  select jsonb_build_object(
    'fecha', p_fecha,
    'cobertura', (
      select jsonb_build_object(
        'recibidas', coalesce(recibidas, 0),
        'auditadas', coalesce(auditadas, 0),
        'baseline',  coalesce(baseline_manual, 0),
        'pct', case when coalesce(recibidas, 0) > 0
                    then round(100.0 * auditadas / recibidas)
                    else 0 end,
        'pctBaseline', case when coalesce(recibidas, 0) > 0
                    then round(100.0 * baseline_manual / recibidas)
                    else 0 end
      ) from dia
    ),
    'ultimas', coalesce((
      select jsonb_agg(x order by ord desc) from (
        select jsonb_build_object(
                 'hora',     to_char(fecha_hora, 'HH24:MI'),
                 -- Nombre de pila unicamente. Ver nota de arriba.
                 'agente',   split_part(agente_nombre, ' ', 1),
                 'duracion', duracion_seg,
                 'tecnica',  puntaje_tecnico,
                 'semaforo', semaforo
               ) x,
               fecha_hora ord
        from llamadas_dia
        order by fecha_hora desc
        limit 12
      ) s
    ), '[]'::jsonb),
    'semaforos', (
      select jsonb_build_object(
        'verde',    count(*) filter (where semaforo = 'verde'),
        'amarillo', count(*) filter (where semaforo = 'amarillo'),
        'rojo',     count(*) filter (where semaforo = 'rojo'),
        'total',    count(*)
      ) from llamadas_dia
    ),
    'banderaTop', (
      select jsonb_build_object('codigo', h.codigo, 'titulo', min(h.titulo), 'veces', count(*))
      from calidad_llamadas_hallazgos h
      join llamadas_dia l on l.id = h.llamada_id
      where h.eje = 'cumplimiento' and h.codigo is not null
      group by h.codigo
      order by count(*) desc, h.codigo
      limit 1
    )
  );
$$;

revoke execute on function public.get_calidad_muro(uuid, date) from public;
revoke execute on function public.get_calidad_muro(uuid, date) from anon;
grant  execute on function public.get_calidad_muro(uuid, date) to authenticated;
grant  execute on function public.get_calidad_muro(uuid, date) to service_role;

-- ── Revoke de los grants por defecto de la instancia ────────────────────────
--
-- Endurecimiento explicito, no correccion de una fuga.
--
-- OJO, esto no es redundante con los `grant select` de arriba. La instancia de
-- ONE tiene ALTER DEFAULT PRIVILEGES (`pg_default_acl`) que otorga TODOS los
-- privilegios (select, insert, update, delete, truncate…) a anon, authenticated
-- y service_role sobre cada tabla nueva de `public`. Se comprobo al aplicar esta
-- migracion: las cinco tablas nacieron con grant completo a `anon`, igual que
-- `ventas_hechos`.
--
-- Que NO significa: `calidad_dinero_cuotas` ya estaba cerrada de verdad con RLS
-- activo y sin policy — sin policy no hay fila que pase el filtro, para ningun
-- rol. Este revoke no destapa ni tapa ningun dato expuesto.
--
-- Que SI significa, y es la razon de dejarlo: la convencion escrita en
-- `metrik-one/CLAUDE.md` ("una tabla sin GRANT explicito es invisible para
-- PostgREST") NO describe esta instancia. Quien la siga al pie de la letra puede
-- concluir que basta con omitir el grant y ahorrarse el RLS — y esa tabla si
-- nace abierta a `anon`. Aqui el RLS es la unica barrera real, asi que se quita
-- el privilegio que no deberia existir en vez de dejar dos capas donde solo una
-- funciona.
revoke all on public.calidad_llamadas            from anon, authenticated;
revoke all on public.calidad_llamadas_bloques    from anon, authenticated;
revoke all on public.calidad_llamadas_hallazgos  from anon, authenticated;
revoke all on public.calidad_cobertura_dia       from anon, authenticated;

grant select on public.calidad_llamadas           to authenticated;
grant select on public.calidad_llamadas_bloques   to authenticated;
grant select on public.calidad_llamadas_hallazgos to authenticated;
grant select on public.calidad_cobertura_dia      to authenticated;

-- Tabla sensible: ni un privilegio para anon ni para authenticated.
revoke all on public.calidad_dinero_cuotas from anon, authenticated;
