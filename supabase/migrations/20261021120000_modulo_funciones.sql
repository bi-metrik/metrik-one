-- ============================================================
-- 20261021120000 — Módulo Funciones: experiencias, montajes, mesas, funciones, reservas y mesas asignadas
-- Diseño: proyectos/sabor-experiencias/clarity/docs/entrada/diseno-etapa2-funciones-mapa.md (etapa 2 de Sabor &
-- Experiencias; Otrosí No. 1, mapa del salón). Primer cliente previsto: Sabor & Experiencias, cuyo workspace NO existe.
--
-- ⚠️ DEPENDE de `20261021090000_asistente_chatwoot.sql` (PR #1225, mergeado y SIN aplicar en producción el
-- 2026-10-21): `funcion_reservas.consentimiento_sensible_id` apunta a `chatwoot_consentimientos`, y esta migración
-- le pone un trigger a esa tabla. Se aplica DESPUÉS de esa, nunca antes (el dry-run aborta si la tabla no existe).
--
-- ⚠️ DDL puro: ni una fila de datos y NINGÚN workspace queda con el módulo encendido. Encenderlo en Sabor (crear el
-- workspace y la fila de `workspace_modulos`) es otra escritura, que autoriza Mauricio (decisión F2 del diseño).
--
-- Qué crea:
--   1. La llave de módulo `funciones` en las CUATRO listas que repiten el catálogo (`workspace_modulos_modulo`,
--      `catalogo_servicios_modulo`, `documentos_versiones_modulo` y `proyectar_modulos`).
--      `src/lib/modulos/catalogo.test.ts` lee la última migración que define cada una y falla si se separan.
--   2. Seis tablas `funcion_*`:
--        experiencias   — la película o experiencia; `minutos_apartado` (HUECO 4) sin valor por defecto.
--        montajes       — el plano de una experiencia (puede tener varios).
--        mesas          — una fila por mesa: puestos, zona, condición INFORMATIVA y posición. Sin columna de precio.
--        funciones      — una fecha y hora con cupo; el montaje es opcional (sin montaje hay cupo y reservas, no mapa).
--        reservas       — las de ONE, no las de viajes de Trappvel (`reservas` no se toca).
--        reserva_mesas  — en qué mesa(s) se sienta cada reserva; una reserva puede repartirse y una mesa compartirse.
--   3. Las funciones de la base (todas SECURITY DEFINER, `search_path = public`):
--        funcion_ocupacion            equipo y servidor   cupo, ocupadas, libres y ocupación por mesa
--        funcion_consultar_cupo       solo service_role   lo único que ve el asistente: cupo libre y si está agotada
--        funcion_apartar              equipo y servidor   candado, vence apartados viejos, aparta o `sin_cupo`
--        funcion_confirmar_pago       equipo y servidor   equipo: `verificado_manual`; servidor: `aprobado`
--        funcion_cancelar_reserva     solo equipo
--        funcion_asignar_mesas        solo equipo         NO la puede ejecutar service_role (la llave del asistente)
--        funcion_guardar_restricciones equipo y servidor  solo con autorización `sensible` = `si` de esa conversación
--      y las del formulario (F1, la única puerta de alta; solo equipo):
--        funcion_guardar_experiencia, funcion_guardar_montaje (con su tabla de mesas), funcion_crear_funciones (una o
--        varias fechas) y funcion_editar_funcion (cupo, estado y cierre de venta, con el candado).
--      El PDF que pre-llena el formulario NO escribe nada: la extracción devuelve un borrador y se guarda lo que la
--      persona confirma, por estas funciones.
--
-- Quién escribe: NADIE escribe las tablas directo, ni `authenticated` ni `service_role`. Se leen por workspace con
-- RLS; toda escritura pasa por las funciones de arriba, que validan las invariantes dentro del candado.
--
-- La ocupación NO se guarda en ningún contador: es la suma de las reservas `confirmada` más las `apartada` con
-- `vence_at > now()`. Toda operación que cambia la ocupación de una función empieza con
-- `select … from funcion_funciones where id = $1 for update`: dos apartados a la vez esperan en fila y el segundo ve
-- lo que dejó el primero. Dentro del mismo candado se marcan `vencida` los apartados vencidos de esa función. Orden de
-- candados siempre igual: primero la función, después la reserva.
--
-- Errores: `raise exception '<codigo>'` con `errcode = 'P0001'`; el mensaje ES el código estable (`sin_cupo`,
-- `funcion_cerrada`, `venta_cerrada`, `sin_regla_apartado`, `mesa_llena`, `mesa_de_otro_montaje`,
-- `personas_no_cuadran`, `reserva_inactiva`, `sin_autorizacion`, `sin_autorizacion_sensible`, …) y el detalle humano
-- va en DETAIL.
--
-- Verificación después de aplicar (solo lectura):
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relname like 'funcion\_%' and relkind = 'r';
--     -> 6 filas, todas con relrowsecurity = true
--   select t.relname,
--          has_table_privilege('anon', t.oid, 'select')                 as anon_sel,
--          has_table_privilege('authenticated', t.oid, 'select')        as auth_sel,
--          has_table_privilege('authenticated', t.oid, 'insert')        as auth_ins,
--          has_table_privilege('service_role', t.oid, 'update')         as srv_upd
--     from pg_class t
--    where t.relnamespace = 'public'::regnamespace and t.relname like 'funcion\_%' and t.relkind = 'r';
--     -> anon_sel false, auth_sel true, auth_ins false y srv_upd false en las 6
--   select has_function_privilege('service_role', 'public.funcion_asignar_mesas(uuid, jsonb)', 'execute');  -> false
--   select has_function_privilege('anon', 'public.funcion_apartar(uuid, uuid, integer, jsonb, text, text)', 'execute'); -> false
--   select count(*) from public.workspace_modulos where modulo = 'funciones';                       -> 0
--   select count(*) from public.workspaces where coalesce(modules->'funciones' = 'true'::jsonb, false); -> 0
--
-- Cómo revertir (nada la usa todavía):
--   drop trigger funcion_consentimiento_borrado on public.chatwoot_consentimientos;
--   drop table public.funcion_reserva_mesas, public.funcion_reservas, public.funcion_funciones,
--              public.funcion_mesas, public.funcion_montajes, public.funcion_experiencias;
--   drop function public.funcion_guardar_experiencia, public.funcion_guardar_montaje, public.funcion_crear_funciones,
--     public.funcion_editar_funcion, public.funcion_actor, public.funcion_ocupadas, public.funcion_vencer_apartados, public.funcion_ocupacion,
--     public.funcion_consultar_cupo, public.funcion_apartar, public.funcion_confirmar_pago, public.funcion_cancelar_reserva,
--     public.funcion_asignar_mesas, public.funcion_guardar_restricciones, y las de los triggers;
--   -- y devolver las cuatro listas de llaves al cuerpo de 20260928180000 / 20260929030000.
-- ============================================================


-- ── 1. La llave de módulo nueva en las cuatro listas ─────────────────────────

alter table public.workspace_modulos drop constraint workspace_modulos_modulo;
alter table public.workspace_modulos add constraint workspace_modulos_modulo check (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria', 'radar_secop', 'funciones'));

alter table public.catalogo_servicios drop constraint catalogo_servicios_modulo;
alter table public.catalogo_servicios add constraint catalogo_servicios_modulo check (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria', 'radar_secop', 'funciones'));

alter table public.documentos_contractuales_versiones drop constraint documentos_versiones_modulo;
alter table public.documentos_contractuales_versiones
  add constraint documentos_versiones_modulo check
    (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria', 'radar_secop', 'funciones'));

-- Mismo cuerpo que `20260928180000_modulo_radar_secop.sql`; solo cambia el arreglo de llaves.
-- Sigue siendo `stable` (solo ensayo): encenderla es otra migración.
create or replace function public.proyectar_modulos(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claves_modulo constant text[] :=
    array['business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria', 'radar_secop', 'funciones'];
  v_hoy jsonb;
  v_vigentes text[];
  v_proyectado jsonb;
  v_cambios jsonb;
begin
  select coalesce(w.modules, '{}'::jsonb)
    into v_hoy
    from public.workspaces w
   where w.id = p_workspace_id;

  if not found then
    raise exception 'proyectar_modulos: el workspace % no existe', p_workspace_id;
  end if;

  select coalesce(array_agg(distinct wm.modulo), '{}')
    into v_vigentes
    from public.workspace_modulos wm
   where wm.workspace_id = p_workspace_id
     and wm.activo_desde <= now()
     and (wm.activo_hasta is null or wm.activo_hasta > now());

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_proyectado
    from jsonb_each(v_hoy) e
   where e.key <> all (v_claves_modulo);

  v_proyectado := v_proyectado
    || coalesce((select jsonb_object_agg(m, true) from unnest(v_vigentes) m), '{}'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object(
           'modulo', c,
           'hoy', coalesce(v_hoy -> c = 'true'::jsonb, false),
           'proyectado', c = any (v_vigentes)
         ) order by c), '[]'::jsonb)
    into v_cambios
    from unnest(v_claves_modulo) c
   where coalesce(v_hoy -> c = 'true'::jsonb, false) is distinct from (c = any (v_vigentes));

  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'hoy', v_hoy,
    'proyectado', v_proyectado,
    'cambios', v_cambios
  );
end;
$$;

-- server-only: la corren el ensayo de operación y, al encenderla, el cron con service_role.
revoke execute on function public.proyectar_modulos(uuid) from public, anon, authenticated;


-- ── 2. Experiencias ──────────────────────────────────────────────────────────

create table public.funcion_experiencias (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  nombre text not null check (length(btrim(nombre)) > 0),
  -- Cuánto dura un apartado sin pago. HUECO 4 (lo decide Paula): SIN valor por defecto. Nulo = `apartar` responde
  -- `sin_regla_apartado` y no aparta. Tope de una semana para que un error de tecleo no congele el cupo.
  minutos_apartado integer check (minutos_apartado is null or minutos_apartado between 1 and 10080),
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funcion_experiencias_id_ws unique (id, workspace_id)
);

comment on table public.funcion_experiencias is
  'Módulo funciones: la película o experiencia. La ficha del asistente (historia, precios, condiciones) vive en el reglamento del bot y anota este id; aquí no se duplica.';


-- ── 3. Montajes y mesas ──────────────────────────────────────────────────────

create table public.funcion_montajes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  experiencia_id uuid not null,
  nombre text not null check (length(btrim(nombre)) > 0),
  notas text,
  created_at timestamptz not null default now(),
  constraint funcion_montajes_experiencia foreign key (experiencia_id, workspace_id)
    references public.funcion_experiencias (id, workspace_id),
  constraint funcion_montajes_id_ws unique (id, workspace_id),
  -- Lo usa la llave de `funcion_funciones (montaje_id, experiencia_id)`: una función solo usa un montaje de SU
  -- experiencia, y un montaje usado por alguna función no se cambia de experiencia (la llave lo impide).
  constraint funcion_montajes_id_experiencia unique (id, experiencia_id)
);

create index idx_funcion_montajes_experiencia on public.funcion_montajes (experiencia_id);

create table public.funcion_mesas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  montaje_id uuid not null,
  -- Como la llama el equipo ("M1", "Frente 2").
  etiqueta text not null check (length(btrim(etiqueta)) > 0),
  -- Los puestos son un número por mesa, no filas por silla (HUECO 2: si Sabor numera sillas, va otra tabla).
  puestos integer not null check (puestos between 1 and 100),
  zona text,
  -- INFORMATIVA: qué tiene de distinto la ubicación, en palabras de Sabor. A propósito no hay columna de precio ni de
  -- recargo: el precio no cambia según la mesa (decisión de Mauricio, 2026-10-21).
  condicion text,
  -- Posición en una cuadrícula relativa de 0 a 100.
  x numeric(6, 2) not null default 0 check (x between 0 and 100),
  y numeric(6, 2) not null default 0 check (y between 0 and 100),
  ancho numeric(6, 2) not null default 8 check (ancho > 0 and ancho <= 100),
  alto numeric(6, 2) not null default 8 check (alto > 0 and alto <= 100),
  forma text not null default 'rectangular' check (forma in ('redonda', 'rectangular')),
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  constraint funcion_mesas_montaje foreign key (montaje_id, workspace_id)
    references public.funcion_montajes (id, workspace_id),
  -- Diferible: el formulario puede intercambiar dos etiquetas en un mismo guardado (`funcion_guardar_montaje`).
  constraint funcion_mesas_etiqueta_unica unique (montaje_id, etiqueta) deferrable initially deferred,
  constraint funcion_mesas_id_montaje unique (id, montaje_id)
);


-- ── 4. Funciones ─────────────────────────────────────────────────────────────

create table public.funcion_funciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  experiencia_id uuid not null,
  -- Opcional: sin montaje no hay mapa, pero hay cupo y reservas (la recepción no depende del mapa).
  montaje_id uuid,
  -- Se muestra y se agrupa en America/Bogota.
  inicia_at timestamptz not null,
  cupo_total integer not null check (cupo_total between 1 and 10000),
  -- abierta: se vende · cerrada: no se vende más, se sigue atendiendo · cancelada.
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada', 'cancelada')),
  -- Desde cuándo no se aparta más (HUECO 5). Nulo = hasta la hora de inicio.
  cierra_venta_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funcion_funciones_experiencia foreign key (experiencia_id, workspace_id)
    references public.funcion_experiencias (id, workspace_id),
  constraint funcion_funciones_montaje foreign key (montaje_id, experiencia_id)
    references public.funcion_montajes (id, experiencia_id),
  constraint funcion_funciones_id_ws unique (id, workspace_id),
  constraint funcion_funciones_id_montaje unique (id, montaje_id)
);

create index idx_funcion_funciones_dia on public.funcion_funciones (workspace_id, inicia_at);
create index idx_funcion_funciones_montaje on public.funcion_funciones (montaje_id) where montaje_id is not null;


-- ── 5. Reservas ──────────────────────────────────────────────────────────────

create table public.funcion_reservas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  funcion_id uuid not null,
  personas integer not null check (personas between 1 and 500),
  -- El cliente en la base de clientes (Anexo 2.2, punto 7). Se busca por teléfono y, si no está, se crea.
  contacto_id uuid references public.contactos(id),
  -- Como los dio el cliente. HUECO 7 del diseño de etapa 1: para qué se pide la cédula.
  nombre text check (nombre is null or length(nombre) <= 200),
  documento text check (documento is null or length(documento) <= 40),
  telefono text check (telefono is null or length(telefono) <= 40),
  -- El usuario del canal (IG, TikTok) cuando no hay teléfono.
  contacto_canal text check (contacto_canal is null or length(contacto_canal) <= 200),
  canal text not null check (canal in ('instagram', 'tiktok', 'whatsapp', 'otro', 'equipo')),
  chatwoot_cuenta_id bigint,
  chatwoot_conversacion_id bigint,
  estado text not null default 'apartada' check (estado in ('apartada', 'confirmada', 'cancelada', 'vencida')),
  vence_at timestamptz,
  pago_estado text not null default 'pendiente'
    check (pago_estado in ('pendiente', 'aprobado', 'verificado_manual', 'rechazado')),
  -- Lo que pidió el cliente ("cerca de la pantalla"). NUNCA es una asignación: la mesa va en `funcion_reserva_mesas`.
  preferencia_mesa text check (preferencia_mesa is null or length(preferencia_mesa) <= 300),
  -- Restricciones alimentarias: dato sensible. Solo con la autorización `sensible` = `si` de la misma conversación.
  restricciones text check (restricciones is null or length(restricciones) <= 1000),
  consentimiento_sensible_id uuid references public.chatwoot_consentimientos(id),
  origen text not null check (origen in ('asistente', 'equipo')),
  clave_idempotencia text not null check (length(btrim(clave_idempotencia)) between 1 and 200),
  creada_por uuid references public.profiles(id),
  confirmada_at timestamptz,
  confirmada_por uuid references public.profiles(id),
  cancelada_at timestamptz,
  cancelada_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funcion_reservas_funcion foreign key (funcion_id, workspace_id)
    references public.funcion_funciones (id, workspace_id),
  constraint funcion_reservas_id_funcion unique (id, funcion_id),
  -- El reintento del asistente (misma huella de la propuesta) devuelve la misma reserva.
  constraint funcion_reservas_clave_unica unique (workspace_id, clave_idempotencia),
  constraint funcion_reservas_restricciones_autorizadas
    check (restricciones is null or consentimiento_sensible_id is not null),
  constraint funcion_reservas_apartada_vence check (estado <> 'apartada' or vence_at is not null),
  constraint funcion_reservas_confirmada_pagada
    check (estado <> 'confirmada' or pago_estado in ('aprobado', 'verificado_manual')),
  constraint funcion_reservas_conversacion_completa
    check ((chatwoot_cuenta_id is null) = (chatwoot_conversacion_id is null)),
  constraint funcion_reservas_asistente_con_conversacion
    check (origen <> 'asistente' or chatwoot_conversacion_id is not null)
);

create index idx_funcion_reservas_funcion on public.funcion_reservas (funcion_id, estado);
create index idx_funcion_reservas_consentimiento on public.funcion_reservas (consentimiento_sensible_id)
  where consentimiento_sensible_id is not null;


-- ── 6. Mesas asignadas ───────────────────────────────────────────────────────

create table public.funcion_reserva_mesas (
  reserva_id uuid not null,
  mesa_id uuid not null,
  workspace_id uuid not null references public.workspaces(id),
  funcion_id uuid not null,
  montaje_id uuid not null,
  personas integer not null check (personas >= 1),
  -- Solo un usuario de ONE del workspace asigna: nunca la llave del asistente.
  asignada_por uuid not null references public.profiles(id),
  asignada_at timestamptz not null default now(),
  primary key (reserva_id, mesa_id),
  -- Las tres llaves hacen estructural que la mesa sea del montaje de la función de la reserva.
  constraint funcion_reserva_mesas_reserva foreign key (reserva_id, funcion_id)
    references public.funcion_reservas (id, funcion_id) on delete cascade,
  constraint funcion_reserva_mesas_funcion foreign key (funcion_id, montaje_id)
    references public.funcion_funciones (id, montaje_id),
  constraint funcion_reserva_mesas_mesa foreign key (mesa_id, montaje_id)
    references public.funcion_mesas (id, montaje_id)
);

create index idx_funcion_reserva_mesas_mesa on public.funcion_reserva_mesas (funcion_id, mesa_id);


-- ── 7. RLS y grants ──────────────────────────────────────────────────────────

alter table public.funcion_experiencias enable row level security;
alter table public.funcion_montajes enable row level security;
alter table public.funcion_mesas enable row level security;
alter table public.funcion_funciones enable row level security;
alter table public.funcion_reservas enable row level security;
alter table public.funcion_reserva_mesas enable row level security;

-- Lectura por workspace. Sin políticas de escritura y sin grant de escritura: escriben las funciones de la base.
create policy funcion_experiencias_lectura on public.funcion_experiencias
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy funcion_montajes_lectura on public.funcion_montajes
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy funcion_mesas_lectura on public.funcion_mesas
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy funcion_funciones_lectura on public.funcion_funciones
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy funcion_reservas_lectura on public.funcion_reservas
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy funcion_reserva_mesas_lectura on public.funcion_reserva_mesas
  for select using (workspace_id = (select public.current_user_workspace_id()));

revoke all on table public.funcion_experiencias from public, anon, authenticated;
revoke all on table public.funcion_montajes from public, anon, authenticated;
revoke all on table public.funcion_mesas from public, anon, authenticated;
revoke all on table public.funcion_funciones from public, anon, authenticated;
revoke all on table public.funcion_reservas from public, anon, authenticated;
revoke all on table public.funcion_reserva_mesas from public, anon, authenticated;

grant select on public.funcion_experiencias to authenticated;
grant select on public.funcion_montajes to authenticated;
grant select on public.funcion_mesas to authenticated;
grant select on public.funcion_funciones to authenticated;
grant select on public.funcion_reservas to authenticated;
grant select on public.funcion_reserva_mesas to authenticated;

-- service_role nace con todo por el default de la base: se le deja solo la lectura, para que tampoco la llave del
-- asistente pueda escribir una mesa o una reserva saltándose las invariantes.
revoke insert, update, delete, truncate on table public.funcion_experiencias from service_role;
revoke insert, update, delete, truncate on table public.funcion_montajes from service_role;
revoke insert, update, delete, truncate on table public.funcion_mesas from service_role;
revoke insert, update, delete, truncate on table public.funcion_funciones from service_role;
revoke insert, update, delete, truncate on table public.funcion_reservas from service_role;
revoke insert, update, delete, truncate on table public.funcion_reserva_mesas from service_role;
grant select on public.funcion_experiencias, public.funcion_montajes, public.funcion_mesas, public.funcion_funciones,
  public.funcion_reservas, public.funcion_reserva_mesas to service_role;


-- ── 8. Piezas internas: quién llama, ocupación y vencimiento ─────────────────

-- Quién llama: con sesión (`auth.uid()`), un usuario de ONE, que tiene que estar en el workspace (si no, el objeto
-- "no existe": no se confirma que exista en otro espacio) y, para escribir, tener un rol que edite. Sin sesión, el
-- servidor (service_role: el asistente, la pasarela). `anon` no llega aquí: ninguna RPC se le concede.
create or replace function public.funcion_actor(p_workspace_id uuid, p_escribe boolean, p_no_existe text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rol text;
begin
  if v_uid is null then
    return 'servidor';
  end if;
  if p_workspace_id is null or public.current_user_workspace_id() is distinct from p_workspace_id then
    raise exception '%', p_no_existe using errcode = 'P0001';
  end if;
  if p_escribe then
    select role into v_rol from public.profiles where id = v_uid;
    if v_rol is null or v_rol not in ('owner', 'admin', 'supervisor', 'operator') then
      raise exception 'sin_permiso' using errcode = 'P0001', detail = 'Tu rol no puede cambiar reservas.';
    end if;
  end if;
  return 'equipo';
end;
$$;

revoke execute on function public.funcion_actor(uuid, boolean, text) from public, anon, authenticated, service_role;

-- La única definición de ocupación: confirmadas más apartadas no vencidas. Nadie guarda un contador.
create or replace function public.funcion_ocupadas(p_funcion_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(r.personas), 0)::integer
    from public.funcion_reservas r
   where r.funcion_id = p_funcion_id
     and (r.estado = 'confirmada' or (r.estado = 'apartada' and r.vence_at > now()));
$$;

revoke execute on function public.funcion_ocupadas(uuid) from public, anon, authenticated, service_role;

-- Marca `vencida` los apartados vencidos de UNA función. Solo se llama con el candado de esa función tomado.
create or replace function public.funcion_vencer_apartados(p_funcion_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.funcion_reservas
     set estado = 'vencida', updated_at = now()
   where funcion_id = p_funcion_id and estado = 'apartada' and vence_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.funcion_vencer_apartados(uuid) from public, anon, authenticated, service_role;


-- ── 9. Triggers: candados del montaje, de la función y de la reserva ─────────

-- Cancelar o vencer libera las mesas: solo `apartada` y `confirmada` ocupan mesa.
create or replace function public.funcion_reserva_libera_mesas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado in ('cancelada', 'vencida') and old.estado is distinct from new.estado then
    delete from public.funcion_reserva_mesas where reserva_id = new.id;
  end if;
  return new;
end;
$$;

-- PostgreSQL no exige EXECUTE para DISPARAR un trigger: el revoke no la apaga.
revoke execute on function public.funcion_reserva_libera_mesas() from public, anon, authenticated, service_role;

create trigger trg_funcion_reserva_libera_mesas
  after update of estado on public.funcion_reservas
  for each row execute function public.funcion_reserva_libera_mesas();

-- La función: cupo dentro de los puestos del montaje, cupo no por debajo de lo ocupado, montaje fijo si hay mesas.
create or replace function public.funcion_funciones_candados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_puestos integer;
  v_ocupadas integer;
begin
  if new.montaje_id is not null
     and (tg_op = 'INSERT' or new.montaje_id is distinct from old.montaje_id or new.cupo_total <> old.cupo_total) then
    select coalesce(sum(puestos), 0)::integer into v_puestos from public.funcion_mesas where montaje_id = new.montaje_id;
    if new.cupo_total > v_puestos then
      raise exception 'cupo_sobre_puestos' using errcode = 'P0001',
        detail = format('El cupo (%s) pasa los puestos del montaje (%s).', new.cupo_total, v_puestos);
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.montaje_id is distinct from old.montaje_id
       and exists (select 1 from public.funcion_reserva_mesas where funcion_id = old.id) then
      raise exception 'funcion_con_mesas' using errcode = 'P0001',
        detail = 'Hay reservas sentadas: primero se liberan las mesas.';
    end if;
    if new.cupo_total < old.cupo_total then
      v_ocupadas := public.funcion_ocupadas(old.id);
      if new.cupo_total < v_ocupadas then
        raise exception 'cupo_bajo_ocupacion' using errcode = 'P0001',
          detail = format('Hay %s personas ocupando; el cupo no puede bajar a %s.', v_ocupadas, new.cupo_total);
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.funcion_funciones_candados() from public, anon, authenticated, service_role;

create trigger trg_funcion_funciones_candados
  before insert or update on public.funcion_funciones
  for each row execute function public.funcion_funciones_candados();

-- La mesa: no se borra ni baja sus puestos por debajo de lo asignado en una función futura, y el montaje no queda con
-- menos puestos que el cupo de sus funciones futuras. Toma el candado de esas funciones (en orden) antes de mirar.
create or replace function public.funcion_mesas_candados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_montaje uuid := coalesce(new.montaje_id, old.montaje_id);
  v_puestos_nuevos integer := case when tg_op = 'DELETE' then 0 else new.puestos end;
  v_asignados integer;
  v_total integer;
  v_cupo integer;
begin
  if tg_op = 'UPDATE' and new.montaje_id is distinct from old.montaje_id then
    raise exception 'mesa_cambia_montaje' using errcode = 'P0001', detail = 'Una mesa no se mueve a otro montaje.';
  end if;
  if tg_op = 'UPDATE' and new.puestos >= old.puestos then
    return new;
  end if;

  perform 1 from public.funcion_funciones
   where montaje_id = v_montaje and inicia_at > now() and estado <> 'cancelada'
   order by id
   for update;

  if tg_op = 'DELETE' and exists (select 1 from public.funcion_reserva_mesas where mesa_id = old.id) then
    raise exception 'mesa_con_asignaciones' using errcode = 'P0001',
      detail = format('La mesa %s tiene reservas asignadas.', old.etiqueta);
  end if;

  select coalesce(max(s.asignados), 0) into v_asignados
    from (
      select sum(rm.personas)::integer as asignados
        from public.funcion_reserva_mesas rm
        join public.funcion_funciones f on f.id = rm.funcion_id
        join public.funcion_reservas r on r.id = rm.reserva_id
       where rm.mesa_id = old.id and f.inicia_at > now()
         and (r.estado = 'confirmada' or (r.estado = 'apartada' and r.vence_at > now()))
       group by rm.funcion_id
    ) s;
  if v_asignados > v_puestos_nuevos then
    raise exception 'mesa_con_asignaciones' using errcode = 'P0001',
      detail = format('La mesa %s tiene %s personas asignadas en una función futura.', old.etiqueta, v_asignados);
  end if;

  select coalesce(sum(puestos), 0)::integer - old.puestos + v_puestos_nuevos into v_total
    from public.funcion_mesas where montaje_id = v_montaje;
  select max(cupo_total) into v_cupo
    from public.funcion_funciones
   where montaje_id = v_montaje and inicia_at > now() and estado <> 'cancelada';
  if v_cupo is not null and v_cupo > v_total then
    raise exception 'cupo_sobre_puestos' using errcode = 'P0001',
      detail = format('Una función futura tiene cupo %s y el montaje quedaría con %s puestos.', v_cupo, v_total);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.funcion_mesas_candados() from public, anon, authenticated, service_role;

create trigger trg_funcion_mesas_candados
  before update or delete on public.funcion_mesas
  for each row execute function public.funcion_mesas_candados();

-- Supresión de datos: si se borra la autorización sensible, se borran las restricciones que autorizaba.
create or replace function public.funcion_consentimiento_borrado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.funcion_reservas
     set restricciones = null, consentimiento_sensible_id = null, updated_at = now()
   where consentimiento_sensible_id = old.id;
  return old;
end;
$$;

revoke execute on function public.funcion_consentimiento_borrado() from public, anon, authenticated, service_role;

create trigger funcion_consentimiento_borrado
  before delete on public.chatwoot_consentimientos
  for each row execute function public.funcion_consentimiento_borrado();


-- ── 10. Lecturas ─────────────────────────────────────────────────────────────

-- Cupo total, ocupadas, libres y, si hay montaje, por mesa: puestos, personas asignadas y reservas sentadas.
-- La usan el mapa, la lista del día y (recortada) el asistente.
create or replace function public.funcion_ocupacion(p_funcion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f record;
  v_ocupadas integer;
  v_mesas jsonb := null;
begin
  select fu.*, e.nombre as experiencia_nombre
    into f
    from public.funcion_funciones fu
    join public.funcion_experiencias e on e.id = fu.experiencia_id
   where fu.id = p_funcion_id;
  if not found then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  perform public.funcion_actor(f.workspace_id, false, 'funcion_no_existe');

  v_ocupadas := public.funcion_ocupadas(f.id);

  if f.montaje_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'mesa_id', m.id, 'etiqueta', m.etiqueta, 'zona', m.zona, 'condicion', m.condicion,
             'puestos', m.puestos, 'ocupados', o.ocupados, 'libres', greatest(m.puestos - o.ocupados, 0),
             'x', m.x, 'y', m.y, 'ancho', m.ancho, 'alto', m.alto, 'forma', m.forma, 'orden', m.orden,
             'reservas', o.reservas
           ) order by m.orden, m.etiqueta), '[]'::jsonb)
      into v_mesas
      from public.funcion_mesas m
      cross join lateral (
        select coalesce(sum(rm.personas), 0)::integer as ocupados,
               coalesce(jsonb_agg(jsonb_build_object(
                 'reserva_id', r.id, 'nombre', r.nombre, 'personas', rm.personas,
                 'estado', r.estado, 'pago_estado', r.pago_estado
               ) order by rm.asignada_at, r.id), '[]'::jsonb) as reservas
          from public.funcion_reserva_mesas rm
          join public.funcion_reservas r on r.id = rm.reserva_id
         where rm.mesa_id = m.id and rm.funcion_id = f.id
           and (r.estado = 'confirmada' or (r.estado = 'apartada' and r.vence_at > now()))
      ) o
     where m.montaje_id = f.montaje_id;
  end if;

  return jsonb_build_object(
    'funcion_id', f.id,
    'workspace_id', f.workspace_id,
    'experiencia_id', f.experiencia_id,
    'experiencia', f.experiencia_nombre,
    'inicia_at', f.inicia_at,
    'estado', f.estado,
    'cierra_venta_at', f.cierra_venta_at,
    'montaje_id', f.montaje_id,
    'cupo_total', f.cupo_total,
    'ocupadas', v_ocupadas,
    'libres', greatest(f.cupo_total - v_ocupadas, 0),
    'mesas', v_mesas
  );
end;
$$;

-- ejecutable-por-cliente: la lee la pantalla del mapa con la sesión del equipo. Es SECURITY DEFINER y verifica que
-- `auth.uid()` esté en el workspace de la función (`funcion_actor`); con otro workspace responde `funcion_no_existe`.
revoke execute on function public.funcion_ocupacion(uuid) from public, anon;
grant execute on function public.funcion_ocupacion(uuid) to authenticated, service_role;

-- Lo único que ve el asistente: nunca mesas, puestos por mesa ni datos de otras reservas. Solo funciones futuras y
-- del workspace. `estado` sale `cerrada` si ya pasó `cierra_venta_at` (para el cliente es lo mismo: no se aparta).
create or replace function public.funcion_consultar_cupo(p_workspace_id uuid, p_funcion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f record;
  v_libres integer;
begin
  select * into f from public.funcion_funciones
   where id = p_funcion_id and workspace_id = p_workspace_id and inicia_at > now();
  if not found then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  v_libres := greatest(f.cupo_total - public.funcion_ocupadas(f.id), 0);
  return jsonb_build_object(
    'funcion_id', f.id,
    'inicia_at', f.inicia_at,
    'estado', case when f.estado = 'abierta' and f.cierra_venta_at is not null and f.cierra_venta_at <= now()
                   then 'cerrada' else f.estado end,
    'cupo_libre', v_libres,
    'agotada', v_libres = 0
  );
end;
$$;

-- server-only: la llama solo el asistente con la llave de servicio.
revoke execute on function public.funcion_consultar_cupo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.funcion_consultar_cupo(uuid, uuid) to service_role;


-- ── 11. Apartar ──────────────────────────────────────────────────────────────

-- Datos admitidos en `p_datos`. A propósito NO hay campo de mesa: una clave de más (`mesa_id`, `mesas`) se rechaza con
-- `dato_no_admitido`, así que ni el asistente ni un error del servidor pueden sentar a nadie al apartar.
create or replace function public.funcion_apartar(
  p_workspace_id uuid,
  p_funcion_id uuid,
  p_personas integer,
  p_datos jsonb,
  p_clave_idempotencia text,
  p_origen text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.funcion_actor(p_workspace_id, true, 'funcion_no_existe');
  v_datos jsonb := coalesce(p_datos, '{}'::jsonb);
  v_clave text := btrim(coalesce(p_clave_idempotencia, ''));
  v_extra text;
  f record;
  e record;
  r record;
  v_ocupadas integer;
  v_cuenta bigint;
  v_conv bigint;
  v_canal text;
  v_ultima text;
  v_nombre text;
  v_tel text;
  v_contacto uuid;
  v_id uuid;
  v_vence timestamptz;
begin
  if p_origen is distinct from (case v_actor when 'equipo' then 'equipo' else 'asistente' end) then
    raise exception 'origen_invalido' using errcode = 'P0001',
      detail = 'El equipo aparta con origen equipo y el servidor con origen asistente.';
  end if;
  if p_personas is null or p_personas < 1 or p_personas > 500 then
    raise exception 'personas_invalidas' using errcode = 'P0001';
  end if;
  if v_clave = '' or length(v_clave) > 200 then
    raise exception 'sin_clave_idempotencia' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_datos) <> 'object' then
    raise exception 'datos_invalidos' using errcode = 'P0001';
  end if;
  select k into v_extra
    from jsonb_object_keys(v_datos) k
   where k <> all (array['nombre', 'documento', 'telefono', 'contacto_canal', 'canal',
                         'chatwoot_cuenta_id', 'chatwoot_conversacion_id', 'preferencia_mesa'])
   limit 1;
  if v_extra is not null then
    raise exception 'dato_no_admitido' using errcode = 'P0001', detail = v_extra;
  end if;
  if coalesce(v_datos->>'chatwoot_cuenta_id', '0') !~ '^[0-9]{1,18}$'
     or coalesce(v_datos->>'chatwoot_conversacion_id', '0') !~ '^[0-9]{1,18}$' then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'ids de Chatwoot';
  end if;
  v_cuenta := (v_datos->>'chatwoot_cuenta_id')::bigint;
  v_conv := (v_datos->>'chatwoot_conversacion_id')::bigint;
  v_canal := coalesce(nullif(btrim(v_datos->>'canal'), ''), case v_actor when 'equipo' then 'equipo' end);

  -- El candado de la función: todo lo que sigue ve la ocupación quieta.
  select * into f from public.funcion_funciones
   where id = p_funcion_id and workspace_id = p_workspace_id
   for update;
  if not found then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  perform public.funcion_vencer_apartados(f.id);

  -- Misma clave = la misma reserva, sin volver a contar.
  select * into r from public.funcion_reservas
   where workspace_id = p_workspace_id and clave_idempotencia = v_clave;
  if found then
    if r.funcion_id <> f.id or r.personas <> p_personas then
      raise exception 'clave_reusada' using errcode = 'P0001',
        detail = 'La clave ya se usó para otra función u otro número de personas.';
    end if;
    return jsonb_build_object('reserva_id', r.id, 'estado', r.estado, 'vence_at', r.vence_at, 'repetida', true);
  end if;

  select * into e from public.funcion_experiencias where id = f.experiencia_id;
  if f.estado <> 'abierta' or f.inicia_at <= now() or not e.activa then
    raise exception 'funcion_cerrada' using errcode = 'P0001';
  end if;
  if f.cierra_venta_at is not null and f.cierra_venta_at <= now() then
    raise exception 'venta_cerrada' using errcode = 'P0001';
  end if;
  if e.minutos_apartado is null then
    raise exception 'sin_regla_apartado' using errcode = 'P0001',
      detail = 'La experiencia no tiene definido cuánto dura un apartado sin pago.';
  end if;

  if v_actor = 'servidor' then
    if v_canal is null or v_canal not in ('instagram', 'tiktok', 'whatsapp', 'otro') then
      raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'canal';
    end if;
    if v_cuenta is null or v_conv is null then
      raise exception 'sin_autorizacion' using errcode = 'P0001';
    end if;
    -- La última respuesta de la conversación manda: un «no» después de un «sí» retira la autorización.
    select c.respuesta into v_ultima
      from public.chatwoot_consentimientos c
     where c.workspace_id = p_workspace_id and c.cuenta_id = v_cuenta and c.conversacion_id = v_conv
       and c.tipo = 'general'
     order by c.created_at desc, c.id desc
     limit 1;
    if v_ultima is distinct from 'si' then
      raise exception 'sin_autorizacion' using errcode = 'P0001';
    end if;
  elsif v_canal not in ('instagram', 'tiktok', 'whatsapp', 'otro', 'equipo') then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'canal';
  end if;

  v_ocupadas := public.funcion_ocupadas(f.id);
  if v_ocupadas + p_personas > f.cupo_total then
    raise exception 'sin_cupo' using errcode = 'P0001',
      detail = format('Quedan %s puestos.', greatest(f.cupo_total - v_ocupadas, 0));
  end if;

  -- El cliente en la base de clientes: por teléfono, y si no está y hay nombre, se crea.
  v_nombre := nullif(btrim(v_datos->>'nombre'), '');
  v_tel := public.limpiar_telefono(nullif(btrim(v_datos->>'telefono'), ''));
  if v_tel is not null and v_tel <> '' and public.telefono_valido(v_tel) then
    select c.id into v_contacto from public.contactos c
     where c.workspace_id = p_workspace_id and c.telefono = v_tel
     order by c.created_at nulls last, c.id
     limit 1;
    if v_contacto is null and v_nombre is not null then
      insert into public.contactos (workspace_id, nombre, telefono)
      values (p_workspace_id, left(v_nombre, 200), v_tel)
      returning id into v_contacto;
    end if;
  else
    v_tel := null;
  end if;

  v_vence := now() + make_interval(mins => e.minutos_apartado);
  insert into public.funcion_reservas (
    workspace_id, funcion_id, personas, contacto_id, nombre, documento, telefono, contacto_canal, canal,
    chatwoot_cuenta_id, chatwoot_conversacion_id, estado, vence_at, preferencia_mesa, origen, clave_idempotencia,
    creada_por
  ) values (
    p_workspace_id, f.id, p_personas, v_contacto, v_nombre, nullif(btrim(v_datos->>'documento'), ''), v_tel,
    nullif(btrim(v_datos->>'contacto_canal'), ''), v_canal, v_cuenta, v_conv, 'apartada', v_vence,
    nullif(btrim(v_datos->>'preferencia_mesa'), ''), p_origen, v_clave, auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('reserva_id', v_id, 'estado', 'apartada', 'vence_at', v_vence, 'repetida', false);
end;
$$;

-- ejecutable-por-cliente: la usa el equipo con su sesión (origen equipo) y el asistente con service_role (origen
-- asistente). SECURITY DEFINER: con sesión exige que `auth.uid()` esté en el workspace y tenga rol que edite.
revoke execute on function public.funcion_apartar(uuid, uuid, integer, jsonb, text, text) from public, anon;
grant execute on function public.funcion_apartar(uuid, uuid, integer, jsonb, text, text) to authenticated, service_role;


-- ── 12. Confirmar el pago y cancelar ─────────────────────────────────────────

create or replace function public.funcion_confirmar_pago(p_reserva_id uuid, p_pago_estado text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_funcion uuid;
  v_actor text;
  f record;
  r record;
  v_ocupadas integer;
begin
  select workspace_id, funcion_id into v_ws, v_funcion from public.funcion_reservas where id = p_reserva_id;
  if not found then
    raise exception 'reserva_no_existe' using errcode = 'P0001';
  end if;
  v_actor := public.funcion_actor(v_ws, true, 'reserva_no_existe');
  -- El equipo verifica a mano (transferencia, Anexo 2.3); solo la pasarela, desde el servidor, aprueba.
  if (v_actor = 'equipo' and p_pago_estado is distinct from 'verificado_manual')
     or (v_actor = 'servidor' and p_pago_estado is distinct from 'aprobado') then
    raise exception 'pago_estado_invalido' using errcode = 'P0001';
  end if;

  select * into f from public.funcion_funciones where id = v_funcion for update;
  perform public.funcion_vencer_apartados(f.id);
  select * into r from public.funcion_reservas where id = p_reserva_id for update;

  if r.estado = 'confirmada' then
    return jsonb_build_object('reserva_id', r.id, 'estado', r.estado, 'pago_estado', r.pago_estado, 'repetida', true);
  end if;
  if r.estado = 'cancelada' then
    raise exception 'reserva_inactiva' using errcode = 'P0001', detail = 'La reserva está cancelada.';
  end if;
  if f.estado = 'cancelada' then
    raise exception 'funcion_cerrada' using errcode = 'P0001', detail = 'La función está cancelada.';
  end if;
  -- Un apartado vencido ya no ocupaba: solo se confirma si su cupo sigue libre. Nunca por encima del cupo.
  if r.estado = 'vencida' then
    v_ocupadas := public.funcion_ocupadas(f.id);
    if v_ocupadas + r.personas > f.cupo_total then
      raise exception 'sin_cupo' using errcode = 'P0001',
        detail = format('El apartado venció y quedan %s puestos.', greatest(f.cupo_total - v_ocupadas, 0));
    end if;
  end if;

  update public.funcion_reservas
     set estado = 'confirmada', pago_estado = p_pago_estado, confirmada_at = now(), confirmada_por = auth.uid(),
         updated_at = now()
   where id = r.id;
  return jsonb_build_object('reserva_id', r.id, 'estado', 'confirmada', 'pago_estado', p_pago_estado, 'repetida', false);
end;
$$;

-- ejecutable-por-cliente: el equipo confirma con su sesión (`verificado_manual`); la pasarela lo hará desde el servidor
-- (`aprobado`). SECURITY DEFINER y verifica el workspace de la reserva con `funcion_actor`.
revoke execute on function public.funcion_confirmar_pago(uuid, text) from public, anon;
grant execute on function public.funcion_confirmar_pago(uuid, text) to authenticated, service_role;

create or replace function public.funcion_cancelar_reserva(p_reserva_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_funcion uuid;
  r record;
begin
  select workspace_id, funcion_id into v_ws, v_funcion from public.funcion_reservas where id = p_reserva_id;
  if not found then
    raise exception 'reserva_no_existe' using errcode = 'P0001';
  end if;
  if public.funcion_actor(v_ws, true, 'reserva_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;

  perform 1 from public.funcion_funciones where id = v_funcion for update;
  perform public.funcion_vencer_apartados(v_funcion);
  select * into r from public.funcion_reservas where id = p_reserva_id for update;
  if r.estado = 'cancelada' then
    return jsonb_build_object('reserva_id', r.id, 'estado', 'cancelada', 'repetida', true);
  end if;

  -- El trigger `trg_funcion_reserva_libera_mesas` quita sus mesas.
  update public.funcion_reservas
     set estado = 'cancelada', cancelada_at = now(), cancelada_por = auth.uid(), updated_at = now()
   where id = r.id;
  return jsonb_build_object('reserva_id', r.id, 'estado', 'cancelada', 'repetida', false);
end;
$$;

-- ejecutable-por-cliente: solo el equipo, con su sesión. SECURITY DEFINER; exige sesión del workspace de la reserva.
revoke execute on function public.funcion_cancelar_reserva(uuid) from public, anon, service_role;
grant execute on function public.funcion_cancelar_reserva(uuid) to authenticated;


-- ── 13. Asignar mesas (solo el equipo) ───────────────────────────────────────

-- Reemplaza las mesas de la reserva por las dadas: `[{"mesa_id": "…", "personas": 4}, …]`. Vacío = liberar. Mover es
-- asignar de nuevo. Todo o nada: si una mesa no cabe, no queda ninguna asignación a medias.
create or replace function public.funcion_asignar_mesas(p_reserva_id uuid, p_asignaciones jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_funcion uuid;
  v_asig jsonb := coalesce(p_asignaciones, '[]'::jsonb);
  f record;
  r record;
  m record;
  v_item jsonb;
  v_personas integer;
  v_suma integer := 0;
  v_n integer;
  v_distintas integer;
  v_ocupados integer;
begin
  select workspace_id, funcion_id into v_ws, v_funcion from public.funcion_reservas where id = p_reserva_id;
  if not found then
    raise exception 'reserva_no_existe' using errcode = 'P0001';
  end if;
  -- Nunca la llave del asistente: además de no tener EXECUTE, sin sesión no pasa.
  if public.funcion_actor(v_ws, true, 'reserva_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_asig) <> 'array' then
    raise exception 'asignaciones_invalidas' using errcode = 'P0001';
  end if;

  select * into f from public.funcion_funciones where id = v_funcion for update;
  perform public.funcion_vencer_apartados(f.id);
  select * into r from public.funcion_reservas where id = p_reserva_id for update;

  if not (r.estado = 'confirmada' or (r.estado = 'apartada' and r.vence_at > now())) then
    raise exception 'reserva_inactiva' using errcode = 'P0001',
      detail = format('La reserva está %s.', r.estado);
  end if;
  if f.montaje_id is null then
    raise exception 'funcion_sin_montaje' using errcode = 'P0001',
      detail = 'Esta función no tiene plano del salón.';
  end if;

  v_n := jsonb_array_length(v_asig);
  for v_item in select value from jsonb_array_elements(v_asig) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'mesa_id', '') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(v_item->>'personas', '') !~ '^[0-9]{1,4}$'
       or (v_item->>'personas')::integer < 1 then
      raise exception 'asignaciones_invalidas' using errcode = 'P0001';
    end if;
    v_suma := v_suma + (v_item->>'personas')::integer;
  end loop;
  select count(distinct value->>'mesa_id') into v_distintas from jsonb_array_elements(v_asig);
  if v_distintas <> v_n then
    raise exception 'asignaciones_invalidas' using errcode = 'P0001', detail = 'Una mesa aparece dos veces.';
  end if;
  -- La suma de la reserva en sus mesas es igual a sus personas, o cero (sin mesa).
  if v_n > 0 and v_suma <> r.personas then
    raise exception 'personas_no_cuadran' using errcode = 'P0001',
      detail = format('La reserva es de %s personas y la asignación suma %s.', r.personas, v_suma);
  end if;

  delete from public.funcion_reserva_mesas where reserva_id = r.id;

  for v_item in select value from jsonb_array_elements(v_asig) loop
    v_personas := (v_item->>'personas')::integer;
    select * into m from public.funcion_mesas where id = (v_item->>'mesa_id')::uuid;
    if not found or m.montaje_id <> f.montaje_id then
      raise exception 'mesa_de_otro_montaje' using errcode = 'P0001',
        detail = 'La mesa no es del plano de esta función.';
    end if;
    select coalesce(sum(rm.personas), 0)::integer into v_ocupados
      from public.funcion_reserva_mesas rm
      join public.funcion_reservas x on x.id = rm.reserva_id
     where rm.mesa_id = m.id and rm.funcion_id = f.id
       and (x.estado = 'confirmada' or (x.estado = 'apartada' and x.vence_at > now()));
    if v_ocupados + v_personas > m.puestos then
      raise exception 'mesa_llena' using errcode = 'P0001',
        detail = format('La mesa %s tiene %s puestos libres.', m.etiqueta, greatest(m.puestos - v_ocupados, 0));
    end if;
    insert into public.funcion_reserva_mesas
      (reserva_id, mesa_id, workspace_id, funcion_id, montaje_id, personas, asignada_por)
    values (r.id, m.id, r.workspace_id, f.id, f.montaje_id, v_personas, auth.uid());
  end loop;

  return jsonb_build_object(
    'reserva_id', r.id,
    'mesas', coalesce((
      select jsonb_agg(jsonb_build_object('mesa_id', rm.mesa_id, 'personas', rm.personas) order by rm.mesa_id)
        from public.funcion_reserva_mesas rm where rm.reserva_id = r.id), '[]'::jsonb)
  );
end;
$$;

-- ejecutable-por-cliente: solo el equipo con su sesión. NO se concede a service_role: la llave del asistente no
-- puede asignar una mesa (regla 1 de la decisión de Mauricio del 2026-10-21).
revoke execute on function public.funcion_asignar_mesas(uuid, jsonb) from public, anon, service_role;
grant execute on function public.funcion_asignar_mesas(uuid, jsonb) to authenticated;


-- ── 14. Restricciones alimentarias (dato sensible) ───────────────────────────

-- Texto vacío o nulo = borrar. Con texto, exige la fila de `chatwoot_consentimientos` de tipo `sensible`, respuesta
-- `si`, del mismo workspace, cuenta y conversación de la reserva, y que no haya un «no» posterior. Una reserva sin
-- conversación (la tomó el equipo por fuera del chat) no guarda restricciones mientras Emilio no defina cómo se
-- registra ese consentimiento (E6).
create or replace function public.funcion_guardar_restricciones(p_reserva_id uuid, p_texto text, p_consentimiento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  r record;
  c record;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
begin
  select workspace_id into v_ws from public.funcion_reservas where id = p_reserva_id;
  if not found then
    raise exception 'reserva_no_existe' using errcode = 'P0001';
  end if;
  perform public.funcion_actor(v_ws, true, 'reserva_no_existe');

  select * into r from public.funcion_reservas where id = p_reserva_id for update;

  if v_texto is null then
    update public.funcion_reservas
       set restricciones = null, consentimiento_sensible_id = null, updated_at = now()
     where id = r.id;
    return jsonb_build_object('reserva_id', r.id, 'restricciones', null);
  end if;
  if r.estado in ('cancelada', 'vencida') then
    raise exception 'reserva_inactiva' using errcode = 'P0001';
  end if;
  if length(v_texto) > 1000 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'restricciones';
  end if;

  select * into c from public.chatwoot_consentimientos where id = p_consentimiento_id;
  if not found or c.tipo <> 'sensible' or c.respuesta <> 'si' or c.workspace_id <> r.workspace_id
     or r.chatwoot_cuenta_id is null or c.cuenta_id <> r.chatwoot_cuenta_id
     or c.conversacion_id <> r.chatwoot_conversacion_id then
    raise exception 'sin_autorizacion_sensible' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.chatwoot_consentimientos x
     where x.workspace_id = c.workspace_id and x.cuenta_id = c.cuenta_id and x.conversacion_id = c.conversacion_id
       and x.tipo = 'sensible' and x.respuesta = 'no' and x.created_at > c.created_at
  ) then
    raise exception 'sin_autorizacion_sensible' using errcode = 'P0001', detail = 'La persona retiró la autorización.';
  end if;

  update public.funcion_reservas
     set restricciones = v_texto, consentimiento_sensible_id = c.id, updated_at = now()
   where id = r.id;
  return jsonb_build_object('reserva_id', r.id, 'restricciones', v_texto);
end;
$$;

-- ejecutable-por-cliente: la usa el servidor (asistente) y el equipo con su sesión. SECURITY DEFINER; con sesión exige
-- el workspace de la reserva y rol que edite.
revoke execute on function public.funcion_guardar_restricciones(uuid, text, uuid) from public, anon;
grant execute on function public.funcion_guardar_restricciones(uuid, text, uuid) to authenticated, service_role;


-- ── 15. Alta desde el formulario (F1, resuelta por Mauricio el 2026-10-21) ───
-- El formulario de ONE es la ÚNICA puerta de entrada de experiencias, montajes y funciones. El PDF que lo pre-llena
-- nunca llega aquí: la extracción devuelve un borrador al navegador y lo que se guarda es lo que la persona confirma
-- con el botón del formulario, por estas funciones. Solo el equipo (con sesión); ninguna se concede a service_role.

create or replace function public.funcion_guardar_experiencia(
  p_workspace_id uuid,
  p_experiencia_id uuid,
  p_nombre text,
  p_minutos_apartado integer,
  p_activa boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_id uuid;
begin
  if public.funcion_actor(p_workspace_id, true, 'experiencia_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  if v_nombre is null or length(v_nombre) > 200 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'nombre';
  end if;
  if p_minutos_apartado is not null and (p_minutos_apartado < 1 or p_minutos_apartado > 10080) then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'minutos_apartado';
  end if;

  if p_experiencia_id is null then
    insert into public.funcion_experiencias (workspace_id, nombre, minutos_apartado, activa)
    values (p_workspace_id, v_nombre, p_minutos_apartado, coalesce(p_activa, true))
    returning id into v_id;
  else
    update public.funcion_experiencias
       set nombre = v_nombre, minutos_apartado = p_minutos_apartado, activa = coalesce(p_activa, activa),
           updated_at = now()
     where id = p_experiencia_id and workspace_id = p_workspace_id
    returning id into v_id;
    if v_id is null then
      raise exception 'experiencia_no_existe' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;

-- ejecutable-por-cliente: el formulario, con la sesión del equipo. SECURITY DEFINER; exige el workspace y rol que edite.
revoke execute on function public.funcion_guardar_experiencia(uuid, uuid, text, integer, boolean) from public, anon, service_role;
grant execute on function public.funcion_guardar_experiencia(uuid, uuid, text, integer, boolean) to authenticated;

-- Crea (p_montaje_id nulo) o edita un montaje con su tabla de mesas completa:
--   p_mesas = [{"id"?: uuid, "etiqueta", "puestos", "zona"?, "condicion"?, "x"?, "y"?, "ancho"?, "alto"?, "forma"?}, …]
-- Las mesas con `id` se actualizan, las sin `id` se crean y las que ya no vienen se borran. Los candados de §1.2 los
-- hacen cumplir los triggers de `funcion_mesas` (una mesa con reservas sentadas no se borra ni baja de lo asignado;
-- el montaje no queda con menos puestos que el cupo de una función futura). Orden: altas, subidas, bajadas y bajas,
-- para que un cambio que en total cuadra no falle a mitad de camino.
create or replace function public.funcion_guardar_montaje(
  p_workspace_id uuid,
  p_montaje_id uuid,
  p_experiencia_id uuid,
  p_nombre text,
  p_notas text,
  p_mesas jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_mesas jsonb := coalesce(p_mesas, '[]'::jsonb);
  v_id uuid;
  v_actual record;
  v_item jsonb;
  v_n integer;
  v_etiquetas integer;
  v_orden integer := 0;
  v_nueva uuid;
  v_nuevas uuid[] := '{}';
begin
  if public.funcion_actor(p_workspace_id, true, 'montaje_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  if v_nombre is null or length(v_nombre) > 200 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'nombre';
  end if;
  if not exists (select 1 from public.funcion_experiencias where id = p_experiencia_id and workspace_id = p_workspace_id) then
    raise exception 'experiencia_no_existe' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_mesas) <> 'array' or jsonb_array_length(v_mesas) = 0 or jsonb_array_length(v_mesas) > 300 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'Un montaje tiene entre 1 y 300 mesas.';
  end if;

  v_n := jsonb_array_length(v_mesas);
  for v_item in select value from jsonb_array_elements(v_mesas) loop
    if jsonb_typeof(v_item) <> 'object' or nullif(btrim(coalesce(v_item->>'etiqueta', '')), '') is null
       or length(btrim(v_item->>'etiqueta')) > 40 then
      raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'Toda mesa lleva etiqueta.';
    end if;
    if coalesce(v_item->>'puestos', '') !~ '^[0-9]{1,3}$' or (v_item->>'puestos')::integer not between 1 and 100 then
      raise exception 'puestos_invalidos' using errcode = 'P0001',
        detail = format('La mesa %s tiene que tener entre 1 y 100 puestos.', btrim(v_item->>'etiqueta'));
    end if;
    if v_item ? 'id' and coalesce(v_item->>'id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'id de mesa';
    end if;
  end loop;
  select count(distinct lower(btrim(value->>'etiqueta'))) into v_etiquetas from jsonb_array_elements(v_mesas);
  if v_etiquetas <> v_n then
    raise exception 'etiqueta_repetida' using errcode = 'P0001', detail = 'Dos mesas tienen la misma etiqueta.';
  end if;

  if p_montaje_id is null then
    if exists (select 1 from jsonb_array_elements(v_mesas) e where e.value ? 'id') then
      raise exception 'mesa_de_otro_montaje' using errcode = 'P0001';
    end if;
    insert into public.funcion_montajes (workspace_id, experiencia_id, nombre, notas)
    values (p_workspace_id, p_experiencia_id, v_nombre, nullif(btrim(coalesce(p_notas, '')), ''))
    returning id into v_id;
  else
    select * into v_actual from public.funcion_montajes where id = p_montaje_id and workspace_id = p_workspace_id;
    if not found then
      raise exception 'montaje_no_existe' using errcode = 'P0001';
    end if;
    if v_actual.experiencia_id <> p_experiencia_id
       and exists (select 1 from public.funcion_funciones where montaje_id = p_montaje_id) then
      raise exception 'montaje_en_uso' using errcode = 'P0001',
        detail = 'Un montaje que ya usa una función no se cambia de experiencia.';
    end if;
    -- Una mesa con id que no es de este montaje no se "adopta".
    if exists (
      select 1 from jsonb_array_elements(v_mesas) e
       where e.value ? 'id'
         and not exists (select 1 from public.funcion_mesas m where m.id = (e.value->>'id')::uuid and m.montaje_id = p_montaje_id)
    ) then
      raise exception 'mesa_de_otro_montaje' using errcode = 'P0001';
    end if;
    update public.funcion_montajes
       set experiencia_id = p_experiencia_id, nombre = v_nombre, notas = nullif(btrim(coalesce(p_notas, '')), '')
     where id = p_montaje_id;
    v_id := p_montaje_id;
  end if;

  -- Altas.
  for v_item in select value from jsonb_array_elements(v_mesas) loop
    v_orden := v_orden + 1;
    if not (v_item ? 'id') then
      insert into public.funcion_mesas (workspace_id, montaje_id, etiqueta, puestos, zona, condicion, x, y, ancho, alto, forma, orden)
      values (p_workspace_id, v_id, btrim(v_item->>'etiqueta'), (v_item->>'puestos')::integer,
              nullif(btrim(coalesce(v_item->>'zona', '')), ''), nullif(btrim(coalesce(v_item->>'condicion', '')), ''),
              coalesce((v_item->>'x')::numeric, 0), coalesce((v_item->>'y')::numeric, 0),
              coalesce((v_item->>'ancho')::numeric, 8), coalesce((v_item->>'alto')::numeric, 8),
              coalesce(nullif(v_item->>'forma', ''), 'rectangular'), v_orden)
      returning id into v_nueva;
      v_nuevas := v_nuevas || v_nueva;
    end if;
  end loop;

  -- Cambios de las mesas que siguen, primero las que suben de puestos.
  for v_item in
    select e.value from jsonb_array_elements(v_mesas) with ordinality e(value, i)
      join public.funcion_mesas m on e.value ? 'id' and m.id = (e.value->>'id')::uuid
     order by ((e.value->>'puestos')::integer - m.puestos) desc, e.i
  loop
    update public.funcion_mesas
       set etiqueta = btrim(v_item->>'etiqueta'), puestos = (v_item->>'puestos')::integer,
           zona = nullif(btrim(coalesce(v_item->>'zona', '')), ''), condicion = nullif(btrim(coalesce(v_item->>'condicion', '')), ''),
           x = coalesce((v_item->>'x')::numeric, x), y = coalesce((v_item->>'y')::numeric, y),
           ancho = coalesce((v_item->>'ancho')::numeric, ancho), alto = coalesce((v_item->>'alto')::numeric, alto),
           forma = coalesce(nullif(v_item->>'forma', ''), forma)
     where id = (v_item->>'id')::uuid;
  end loop;
  update public.funcion_mesas m
     set orden = e.i
    from jsonb_array_elements(v_mesas) with ordinality e(value, i)
   where e.value ? 'id' and m.id = (e.value->>'id')::uuid;

  -- Bajas: las mesas que ya no vienen.
  if p_montaje_id is not null then
    delete from public.funcion_mesas m
     where m.montaje_id = v_id
       and m.id <> all (v_nuevas)
       and m.id not in (select (e.value->>'id')::uuid from jsonb_array_elements(v_mesas) e where e.value ? 'id');
  end if;

  -- La unicidad de etiquetas es diferible (para poder intercambiarlas): se verifica aquí, no al final de la transacción.
  set constraints public.funcion_mesas_etiqueta_unica immediate;
  return v_id;
end;
$$;

-- ejecutable-por-cliente: el formulario de montajes, con la sesión del equipo. SECURITY DEFINER; exige el workspace.
revoke execute on function public.funcion_guardar_montaje(uuid, uuid, uuid, text, text, jsonb) from public, anon, service_role;
grant execute on function public.funcion_guardar_montaje(uuid, uuid, uuid, text, text, jsonb) to authenticated;

-- Crea una o varias funciones de una experiencia (una película suele tener varias fechas y horas), todas con el mismo
-- montaje, cupo, estado y cierre de venta (`p_cierre_minutos_antes` antes de cada inicio; nulo = hasta el inicio).
-- `p_inicios` = ["2026-11-09T19:00:00-05:00", …]. Todo o nada.
create or replace function public.funcion_crear_funciones(
  p_workspace_id uuid,
  p_experiencia_id uuid,
  p_montaje_id uuid,
  p_cupo_total integer,
  p_estado text,
  p_cierre_minutos_antes integer,
  p_inicios jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicios jsonb := coalesce(p_inicios, '[]'::jsonb);
  v_inicio timestamptz;
  v_ids jsonb := '[]'::jsonb;
  v_id uuid;
  v_distintos integer;
begin
  if public.funcion_actor(p_workspace_id, true, 'experiencia_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.funcion_experiencias where id = p_experiencia_id and workspace_id = p_workspace_id) then
    raise exception 'experiencia_no_existe' using errcode = 'P0001';
  end if;
  if p_montaje_id is not null and not exists (
    select 1 from public.funcion_montajes where id = p_montaje_id and experiencia_id = p_experiencia_id
  ) then
    raise exception 'montaje_de_otra_experiencia' using errcode = 'P0001';
  end if;
  if p_cupo_total is null or p_cupo_total < 1 or p_cupo_total > 10000 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'cupo_total';
  end if;
  if coalesce(p_estado, '') not in ('abierta', 'cerrada') then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'estado';
  end if;
  if p_cierre_minutos_antes is not null and (p_cierre_minutos_antes < 0 or p_cierre_minutos_antes > 20160) then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'cierre de venta';
  end if;
  if jsonb_typeof(v_inicios) <> 'array' or jsonb_array_length(v_inicios) = 0 or jsonb_array_length(v_inicios) > 60 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'Entre 1 y 60 fechas.';
  end if;
  begin
    select count(distinct value::timestamptz) into v_distintos from jsonb_array_elements_text(v_inicios);
  exception when others then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'Una fecha y hora no se entiende.';
  end;
  if v_distintos <> jsonb_array_length(v_inicios) then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'Una fecha y hora aparece dos veces.';
  end if;

  for v_inicio in select value::timestamptz from jsonb_array_elements_text(v_inicios) loop
    if v_inicio <= now() then
      raise exception 'fecha_pasada' using errcode = 'P0001',
        detail = to_char(v_inicio at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI');
    end if;
    -- El cupo contra los puestos del montaje lo verifica el trigger `trg_funcion_funciones_candados` (cupo_sobre_puestos).
    insert into public.funcion_funciones (workspace_id, experiencia_id, montaje_id, inicia_at, cupo_total, estado, cierra_venta_at)
    values (p_workspace_id, p_experiencia_id, p_montaje_id, v_inicio, p_cupo_total, p_estado,
            case when p_cierre_minutos_antes is null then null else v_inicio - make_interval(mins => p_cierre_minutos_antes) end)
    returning id into v_id;
    v_ids := v_ids || to_jsonb(v_id);
  end loop;
  return v_ids;
end;
$$;

-- ejecutable-por-cliente: el formulario de funciones, con la sesión del equipo. SECURITY DEFINER; exige el workspace.
revoke execute on function public.funcion_crear_funciones(uuid, uuid, uuid, integer, text, integer, jsonb) from public, anon, service_role;
grant execute on function public.funcion_crear_funciones(uuid, uuid, uuid, integer, text, integer, jsonb) to authenticated;

-- Cambia cupo, estado y cierre de venta de una función, con el candado de la función tomado (el cupo no baja de lo
-- ocupado ni pasa los puestos: lo dice el trigger). El montaje no se cambia aquí.
create or replace function public.funcion_editar_funcion(
  p_funcion_id uuid,
  p_cupo_total integer,
  p_estado text,
  p_cierra_venta_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.funcion_funciones where id = p_funcion_id;
  if not found then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  if public.funcion_actor(v_ws, true, 'funcion_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  if coalesce(p_estado, '') not in ('abierta', 'cerrada', 'cancelada') then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'estado';
  end if;
  if p_cupo_total is null or p_cupo_total < 1 or p_cupo_total > 10000 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'cupo_total';
  end if;

  perform 1 from public.funcion_funciones where id = p_funcion_id for update;
  perform public.funcion_vencer_apartados(p_funcion_id);
  update public.funcion_funciones
     set cupo_total = p_cupo_total, estado = p_estado, cierra_venta_at = p_cierra_venta_at
   where id = p_funcion_id;
  return public.funcion_ocupacion(p_funcion_id);
end;
$$;

-- ejecutable-por-cliente: el equipo con su sesión. SECURITY DEFINER; exige el workspace de la función.
revoke execute on function public.funcion_editar_funcion(uuid, integer, text, timestamptz) from public, anon, service_role;
grant execute on function public.funcion_editar_funcion(uuid, integer, text, timestamptz) to authenticated;
