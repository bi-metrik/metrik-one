-- ============================================================
-- 20261022170000 — Módulo Funciones: experiencias, campañas, funciones con dos cupos y precios, y reservas con la foto
-- del monto (Sabor & Experiencias, etapa 2)
-- Diseño: proyectos/sabor-experiencias/clarity/docs/entrada/diseno-etapa2-funciones-mapa.md. Primer cliente previsto:
-- Sabor & Experiencias, cuyo workspace NO existe.
--
-- Decisiones de Mauricio que esta migración hace cumplir:
--   · 2026-10-22, alcance: el MAPA DEL SALÓN SALE de la Fase 1. Sabor no asigna puestos (orden de llegada; a los grupos
--     de 5 o más les guarda mesa a mano, fuera de ONE). Sin montajes, mesas ni puestos. Lo que pide el cliente es texto
--     libre en `funcion_reservas.solicitud_cliente`.
--   · 2026-10-22, «Todo sale y vuelve a ONE»: precios, abono, pago total, cupos y el monto de cada reserva viven aquí.
--     El asistente los lee de aquí y no hace cuentas: `funcion_apartar` calcula el monto y lo guarda como foto.
--   · 2026-10-22, jerarquía Experiencia → Campaña → Función. La experiencia es la película (textos); la campaña, una
--     tanda con su código de atribución, su agenda publicada y sus precios por defecto; la función, un día con su hora,
--     sus dos cupos y sus reemplazos de precio.
--   · `minutos_apartado` vive en la CAMPAÑA (decisión de Max): cuánto aguanta un apartado sin pago es una condición
--     comercial de la tanda, como el abono, y puede cambiar entre preventa y temporada regular de la misma película.
-- Esta versión reemplaza la `20261021120000_modulo_funciones.sql` que nunca se aplicó (esa versión además chocaba
-- con `20261021120000_servicios_fechas_tramos.sql`, ya aplicada).
--
-- ⚠️ DEPENDE de `20261021090000_asistente_chatwoot.sql` (PR #1225): `funcion_reservas.consentimiento_sensible_id`
-- apunta a `chatwoot_consentimientos`, y esta migración le pone un trigger a esa tabla. Se aplica DESPUÉS de esa,
-- nunca antes (el dry-run aborta si la tabla no existe).
--
-- ⚠️ DDL puro: ni una fila de datos y NINGÚN workspace queda con el módulo encendido. Encenderlo en Sabor (crear el
-- workspace y la fila de `workspace_modulos`) es otra escritura, que autoriza Mauricio (decisión F2 del diseño).
--
-- Qué crea:
--   1. La llave de módulo `funciones` en las CUATRO listas que repiten el catálogo (`workspace_modulos_modulo`,
--      `catalogo_servicios_modulo`, `documentos_versiones_modulo` y `proyectar_modulos`).
--   2. Cuatro tablas `funcion_*`:
--        experiencias — la película: nombre, historia, qué incluye, edad mínima, información general.
--        campanas     — una tanda de una experiencia: código de atribución (único, inmutable al publicar), fechas,
--                       estado, agenda publicada, minutos de apartado y precios por defecto.
--        funciones    — un día con su hora: `capacidad` (el equipo aparta hasta aquí) y `cupo_asistente` (el bot
--                       aparta hasta aquí), preventa, reemplazos de precio, estado y cierre de venta.
--        reservas     — con la FOTO del precio (tarifa, precio unitario, total, modalidad, monto a pagar), la campaña
--                       (la pone la base) y la atribución genérica (`atribucion_fuente`, `atribucion_ref`).
--   3. Las reglas, cada una en UN lugar:
--        funcion_tarifa(funcion)           el precio que rige: función → campaña. Preventa: el de preventa, y el
--                                           completo solo como contexto. Abono por persona y si se permite pago total.
--        funcion_motivo_asistente(f, c)    por qué el asistente NO puede ofrecer una función (nulo = disponible):
--                                           campaña activa + agenda publicada + función activa + futura + venta
--                                           abierta + cupo del asistente libre > 0. La usan apartar (origen
--                                           asistente), consultar_cupo, ver_funciones_disponibles y campanas_activas.
--        funcion_ocupadas(funcion)          la única suma de ocupadas, para los dos cupos.
--   4. Las funciones de la base (todas SECURITY DEFINER, `search_path = public`):
--        para el asistente (solo service_role): funcion_consultar_cupo, funcion_ver_disponibles, funcion_campanas_activas;
--        de los dos: funcion_ocupacion, funcion_tarifa, funcion_apartar, funcion_confirmar_pago, funcion_guardar_restricciones;
--        solo del equipo: funcion_cancelar_reserva, funcion_guardar_experiencia, funcion_guardar_campana,
--          funcion_publicar_agenda, funcion_crear_funciones (agenda en lote), funcion_editar_funcion,
--          funcion_eliminar_campana y funcion_eliminar_funcion (con reservas archiva; sin reservas borra).
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
-- Atribución: el camino pauta → lead → reserva → pago se consulta por campaña con UNA llave, `campana_id`, que la base
-- copia de la función a la reserva. El diseño exacto del anuncio y del link (Meta, Chatwoot) está en verificación; por
-- eso aquí solo va lo genérico: `atribucion_fuente` (lista cerrada) y `atribucion_ref` (texto, el id que llegue).
--
-- Errores: `raise exception '<codigo>'` con `errcode = 'P0001'`; el mensaje ES el código estable (`sin_cupo`,
-- `sin_precio`, `modalidad_no_permitida`, `campana_no_publicada`, `campana_no_activa`, `funcion_no_activa`, …) y el
-- detalle humano va en DETAIL.
--
-- Verificación después de aplicar (solo lectura):
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relname like 'funcion\_%' and relkind = 'r';
--     -> 4 filas, todas con relrowsecurity = true
--   select t.relname,
--          has_table_privilege('anon', t.oid, 'select')                 as anon_sel,
--          has_table_privilege('authenticated', t.oid, 'select')        as auth_sel,
--          has_table_privilege('authenticated', t.oid, 'insert')        as auth_ins,
--          has_table_privilege('service_role', t.oid, 'update')         as srv_upd
--     from pg_class t
--    where t.relnamespace = 'public'::regnamespace and t.relname like 'funcion\_%' and t.relkind = 'r';
--     -> anon_sel false, auth_sel true, auth_ins false y srv_upd false en las 4
--   select has_function_privilege('service_role', 'public.funcion_publicar_agenda(uuid)', 'execute');  -> false
--   select has_function_privilege('authenticated', 'public.funcion_ver_disponibles(uuid, text)', 'execute'); -> false
--   select count(*) from public.workspace_modulos where modulo = 'funciones';                       -> 0
--   select count(*) from public.workspaces where coalesce(modules->'funciones' = 'true'::jsonb, false); -> 0
--
-- Cómo revertir (nada la usa todavía):
--   drop trigger funcion_consentimiento_borrado on public.chatwoot_consentimientos;
--   drop table public.funcion_reservas, public.funcion_funciones, public.funcion_campanas, public.funcion_experiencias;
--   drop function public.funcion_* (todas las de este archivo);
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


-- ── 2. Experiencias: la película ─────────────────────────────────────────────

create table public.funcion_experiencias (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  nombre text not null check (length(btrim(nombre)) between 1 and 200),
  -- Los textos de la ficha, en palabras de Sabor. El asistente y el post los leen de aquí; nada se inventa.
  historia text check (historia is null or length(historia) <= 3000),
  que_incluye text check (que_incluye is null or length(que_incluye) <= 2000),
  -- Desde qué edad entra (en unas películas no entran menores; en otras, desde los 6). Nulo = no lo dijo Sabor.
  edad_minima integer check (edad_minima is null or edad_minima between 0 and 99),
  info_general text check (info_general is null or length(info_general) <= 3000),
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funcion_experiencias_id_ws unique (id, workspace_id)
);

comment on table public.funcion_experiencias is
  'Módulo funciones: la película o experiencia (textos de la ficha). Los precios y el código de atribución viven en la campaña.';


-- ── 3. Campañas: una tanda de una experiencia ────────────────────────────────

create table public.funcion_campanas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  experiencia_id uuid not null,
  nombre text not null check (length(btrim(nombre)) between 1 and 200),
  -- El código de atribución: corto y fácil de escribir («HP-OCT26»). Único por workspace; inmutable al publicar.
  codigo text not null check (codigo ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  desde date,
  hasta date,
  estado text not null default 'borrador' check (estado in ('borrador', 'activa', 'pausada', 'cerrada')),
  -- Antes de publicar, nada de la campaña es visible para el asistente.
  agenda_publicada_at timestamptz,
  archivada_at timestamptz,
  -- Cuánto dura un apartado sin pago. HUECO 4 (lo decide Paula): SIN valor por defecto; nulo = `sin_regla_apartado`.
  minutos_apartado integer check (minutos_apartado is null or minutos_apartado between 1 and 10080),
  -- Precios por defecto de sus funciones, en pesos enteros. Cada función puede reemplazarlos.
  precio_persona integer check (precio_persona is null or precio_persona between 1 and 100000000),
  precio_preventa_persona integer check (precio_preventa_persona is null or precio_preventa_persona between 1 and 100000000),
  abono_persona integer check (abono_persona is null or abono_persona between 1 and 100000000),
  permite_pago_total boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funcion_campanas_experiencia foreign key (experiencia_id, workspace_id)
    references public.funcion_experiencias (id, workspace_id),
  constraint funcion_campanas_id_ws unique (id, workspace_id),
  constraint funcion_campanas_codigo_unico unique (workspace_id, codigo),
  constraint funcion_campanas_fechas check (desde is null or hasta is null or hasta >= desde),
  constraint funcion_campanas_activa_publicada check (estado <> 'activa' or agenda_publicada_at is not null)
);

create index idx_funcion_campanas_experiencia on public.funcion_campanas (experiencia_id);


-- ── 4. Funciones: un día con su hora ─────────────────────────────────────────

create table public.funcion_funciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campana_id uuid not null,
  -- Se muestra y se agrupa en America/Bogota.
  inicia_at timestamptz not null,
  -- Cuántas personas caben. El equipo aparta hasta aquí. No baja de lo ocupado.
  capacidad integer not null check (capacidad between 1 and 10000),
  -- Cuántas puede apartar el asistente (1 ≤ cupo_asistente ≤ capacidad). Sale de la MISMA suma de ocupadas: lo que
  -- agrega el equipo le resta al asistente. Puede quedar por debajo de lo ocupado: eso solo frena al bot.
  cupo_asistente integer not null,
  -- activa: se vende · pausada: el asistente no la ofrece, el equipo sí aparta · cancelada.
  estado text not null default 'activa' check (estado in ('activa', 'pausada', 'cancelada')),
  -- Desde cuándo no se aparta más (HUECO 5). Nulo = hasta la hora de inicio.
  cierra_venta_at timestamptz,
  -- Preventa: rige el precio de preventa (de la función o de la campaña); el completo queda como contexto.
  es_preventa boolean not null default false,
  -- Reemplazos opcionales de los precios de la campaña (nulo = el de la campaña). Pesos enteros.
  precio_persona integer check (precio_persona is null or precio_persona between 1 and 100000000),
  precio_preventa_persona integer check (precio_preventa_persona is null or precio_preventa_persona between 1 and 100000000),
  abono_persona integer check (abono_persona is null or abono_persona between 1 and 100000000),
  permite_pago_total boolean,
  archivada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funcion_funciones_campana foreign key (campana_id, workspace_id)
    references public.funcion_campanas (id, workspace_id),
  constraint funcion_funciones_id_ws unique (id, workspace_id),
  constraint funcion_funciones_cupo_asistente check (cupo_asistente between 1 and capacidad)
);

create index idx_funcion_funciones_dia on public.funcion_funciones (workspace_id, inicia_at);
-- La agenda en lote rechaza duplicados exactos: una campaña no tiene dos funciones vivas a la misma hora.
create unique index funcion_funciones_horario_unico on public.funcion_funciones (campana_id, inicia_at)
  where archivada_at is null;


-- ── 5. Reservas ──────────────────────────────────────────────────────────────

create table public.funcion_reservas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  funcion_id uuid not null,
  -- La campaña de la función, copiada por la base al apartar: la llave de la atribución pauta → reserva → pago.
  campana_id uuid not null,
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
  -- De dónde llegó el cliente. Solo lo genérico mientras se verifica el anuncio y el link en Meta y Chatwoot.
  atribucion_fuente text not null check (atribucion_fuente in ('anuncio', 'link_campana', 'preguntado', 'equipo', 'desconocida')),
  atribucion_ref text check (atribucion_ref is null or length(atribucion_ref) <= 200),
  estado text not null default 'apartada' check (estado in ('apartada', 'confirmada', 'cancelada', 'vencida')),
  vence_at timestamptz,
  pago_estado text not null default 'pendiente'
    check (pago_estado in ('pendiente', 'aprobado', 'verificado_manual', 'rechazado')),
  -- La FOTO del precio al apartar, calculada por la base con `funcion_tarifa`. Cambiar un precio después no la toca.
  -- El asistente nunca manda montos.
  tarifa text not null check (tarifa in ('preventa', 'completa')),
  precio_unitario integer not null check (precio_unitario >= 1),
  monto_total bigint not null,
  modalidad text not null check (modalidad in ('abono', 'total')),
  abono_unitario integer check (abono_unitario is null or abono_unitario >= 1),
  monto_a_pagar bigint not null,
  -- Lo que pidió el cliente, en sus palabras («vamos 6, queremos estar juntos»). Texto libre, SIN ninguna lógica.
  solicitud_cliente text check (solicitud_cliente is null or length(solicitud_cliente) <= 500),
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
  constraint funcion_reservas_campana foreign key (campana_id, workspace_id)
    references public.funcion_campanas (id, workspace_id),
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
    check (origen <> 'asistente' or chatwoot_conversacion_id is not null),
  constraint funcion_reservas_monto_total check (monto_total = personas::bigint * precio_unitario),
  constraint funcion_reservas_monto_a_pagar check (
    (modalidad = 'total' and abono_unitario is null and monto_a_pagar = monto_total)
    or (modalidad = 'abono' and abono_unitario is not null and abono_unitario <= precio_unitario
        and monto_a_pagar = personas::bigint * abono_unitario)
  )
);

create index idx_funcion_reservas_funcion on public.funcion_reservas (funcion_id, estado);
create index idx_funcion_reservas_campana on public.funcion_reservas (campana_id, created_at);
create index idx_funcion_reservas_consentimiento on public.funcion_reservas (consentimiento_sensible_id)
  where consentimiento_sensible_id is not null;


-- ── 6. RLS y grants ──────────────────────────────────────────────────────────

alter table public.funcion_experiencias enable row level security;
alter table public.funcion_campanas enable row level security;
alter table public.funcion_funciones enable row level security;
alter table public.funcion_reservas enable row level security;

-- Lectura por workspace. Sin políticas de escritura y sin grant de escritura: escriben las funciones de la base.
create policy funcion_experiencias_lectura on public.funcion_experiencias
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy funcion_campanas_lectura on public.funcion_campanas
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy funcion_funciones_lectura on public.funcion_funciones
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy funcion_reservas_lectura on public.funcion_reservas
  for select using (workspace_id = (select public.current_user_workspace_id()));

revoke all on table public.funcion_experiencias from public, anon, authenticated;
revoke all on table public.funcion_campanas from public, anon, authenticated;
revoke all on table public.funcion_funciones from public, anon, authenticated;
revoke all on table public.funcion_reservas from public, anon, authenticated;

grant select on public.funcion_experiencias to authenticated;
grant select on public.funcion_campanas to authenticated;
grant select on public.funcion_funciones to authenticated;
grant select on public.funcion_reservas to authenticated;

-- service_role nace con todo por el default de la base: se le deja solo la lectura, para que tampoco la llave del
-- asistente pueda escribir una reserva o un precio saltándose las invariantes.
revoke insert, update, delete, truncate on table public.funcion_experiencias from service_role;
revoke insert, update, delete, truncate on table public.funcion_campanas from service_role;
revoke insert, update, delete, truncate on table public.funcion_funciones from service_role;
revoke insert, update, delete, truncate on table public.funcion_reservas from service_role;
grant select on public.funcion_experiencias, public.funcion_campanas, public.funcion_funciones, public.funcion_reservas
  to service_role;


-- ── 7. Piezas internas: quién llama, ocupación y vencimiento ─────────────────

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


-- ── 8. Las reglas en un solo lugar: tarifa y disponibilidad para el asistente ───

-- EL ÚNICO lugar donde se resuelve el precio que rige una función («Todo sale y vuelve a ONE»): el reemplazo de la
-- función → si no, el de la campaña. En preventa rige el precio de preventa y el completo va solo como contexto.
-- Devuelve también el abono por persona y si se permite el pago total. Pesos enteros. Si el abono pasa el precio que
-- rige: `abono_sobre_precio` (los triggers no dejan guardar una tarifa así).
create or replace function public.funcion_tarifa(p_funcion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f record;
  c record;
  v_completo integer;
  v_preventa integer;
  v_rige integer;
  v_abono integer;
  v_permite boolean;
begin
  select * into f from public.funcion_funciones where id = p_funcion_id;
  if not found then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  perform public.funcion_actor(f.workspace_id, false, 'funcion_no_existe');
  select * into c from public.funcion_campanas where id = f.campana_id;

  v_completo := coalesce(f.precio_persona, c.precio_persona);
  v_preventa := coalesce(f.precio_preventa_persona, c.precio_preventa_persona);
  v_rige := case when f.es_preventa then v_preventa else v_completo end;
  v_abono := coalesce(f.abono_persona, c.abono_persona);
  v_permite := coalesce(f.permite_pago_total, c.permite_pago_total);
  if v_abono is not null and v_rige is not null and v_abono > v_rige then
    raise exception 'abono_sobre_precio' using errcode = 'P0001',
      detail = format('El abono por persona (%s) pasa el precio que rige (%s).', v_abono, v_rige);
  end if;

  return jsonb_build_object(
    'tarifa', case when f.es_preventa then 'preventa' else 'completa' end,
    'precio_persona', v_rige,
    'precio_completo_persona', case when f.es_preventa then v_completo end,
    'abono_persona', v_abono,
    'permite_pago_total', v_permite
  );
end;
$$;

-- ejecutable-por-cliente: la leen las pantallas con la sesión del equipo y el servidor. SECURITY DEFINER; con sesión
-- verifica que `auth.uid()` esté en el workspace de la función (`funcion_actor`).
revoke execute on function public.funcion_tarifa(uuid) from public, anon;
grant execute on function public.funcion_tarifa(uuid) to authenticated, service_role;

-- EL ÚNICO lugar de la regla «disponible para el asistente». Devuelve por qué NO (nulo = disponible), en este orden:
-- archivada, campaña no publicada, campaña no activa, función no activa, función pasada, venta cerrada, agotada (sin
-- cupo del asistente libre). La usan funcion_apartar (origen asistente), funcion_consultar_cupo,
-- funcion_ver_disponibles y funcion_campanas_activas.
create or replace function public.funcion_motivo_asistente(f public.funcion_funciones, c public.funcion_campanas)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when f.archivada_at is not null or c.archivada_at is not null then 'funcion_archivada'
    when c.agenda_publicada_at is null then 'campana_no_publicada'
    when c.estado <> 'activa' then 'campana_no_activa'
    when f.estado <> 'activa' then 'funcion_no_activa'
    when f.inicia_at <= now() then 'funcion_pasada'
    when f.cierra_venta_at is not null and f.cierra_venta_at <= now() then 'venta_cerrada'
    when f.cupo_asistente - public.funcion_ocupadas(f.id) <= 0 then 'agotada'
    else null
  end;
$$;

revoke execute on function public.funcion_motivo_asistente(public.funcion_funciones, public.funcion_campanas)
  from public, anon, authenticated, service_role;


-- ── 9. Triggers: capacidad, tarifa, código y autorización borrada ────────────

-- La capacidad no baja de lo ocupado (el cupo del asistente sí puede: solo frena al bot). Corre con la fila de la
-- función ya bloqueada por el UPDATE.
create or replace function public.funcion_funciones_candados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ocupadas integer;
begin
  if new.capacidad < old.capacidad then
    v_ocupadas := public.funcion_ocupadas(old.id);
    if new.capacidad < v_ocupadas then
      raise exception 'capacidad_bajo_ocupacion' using errcode = 'P0001',
        detail = format('Hay %s personas ocupando; la capacidad no puede bajar a %s.', v_ocupadas, new.capacidad);
    end if;
  end if;
  if new.campana_id is distinct from old.campana_id then
    raise exception 'funcion_cambia_campana' using errcode = 'P0001', detail = 'Una función no se mueve de campaña.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- PostgreSQL no exige EXECUTE para DISPARAR un trigger: el revoke no la apaga.
revoke execute on function public.funcion_funciones_candados() from public, anon, authenticated, service_role;

create trigger trg_funcion_funciones_candados
  before update on public.funcion_funciones
  for each row execute function public.funcion_funciones_candados();

-- La tarifa que rige tiene que cuadrar (el abono no pasa el precio): se verifica con `funcion_tarifa` al crear o
-- cambiar una función y al cambiar los precios de su campaña (sus funciones futuras y vivas).
create or replace function public.funcion_tarifa_cuadra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'funcion_funciones' then
    perform public.funcion_tarifa(new.id);
  else
    perform public.funcion_tarifa(f.id)
       from public.funcion_funciones f
      where f.campana_id = new.id and f.inicia_at > now() and f.estado <> 'cancelada' and f.archivada_at is null;
  end if;
  return null;
end;
$$;

revoke execute on function public.funcion_tarifa_cuadra() from public, anon, authenticated, service_role;

create trigger trg_funcion_funciones_tarifa
  after insert or update of precio_persona, precio_preventa_persona, abono_persona, permite_pago_total, es_preventa
  on public.funcion_funciones
  for each row execute function public.funcion_tarifa_cuadra();

create trigger trg_funcion_campanas_tarifa
  after update of precio_persona, precio_preventa_persona, abono_persona, permite_pago_total on public.funcion_campanas
  for each row execute function public.funcion_tarifa_cuadra();

-- El código de atribución no cambia después de publicar la agenda: ya está en anuncios, links y reservas.
create or replace function public.funcion_campanas_candados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.agenda_publicada_at is not null and new.codigo is distinct from old.codigo then
    raise exception 'codigo_publicado' using errcode = 'P0001',
      detail = 'El código de una campaña publicada no cambia.';
  end if;
  if new.experiencia_id is distinct from old.experiencia_id
     and exists (select 1 from public.funcion_funciones where campana_id = old.id) then
    raise exception 'campana_con_funciones' using errcode = 'P0001',
      detail = 'Una campaña con funciones no cambia de experiencia.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.funcion_campanas_candados() from public, anon, authenticated, service_role;

create trigger trg_funcion_campanas_candados
  before update on public.funcion_campanas
  for each row execute function public.funcion_campanas_candados();

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

-- Capacidad, cupo del asistente, ocupadas (UNA suma para los dos), libres del equipo, libres del asistente, la tarifa
-- y la campaña. La usan las pantallas del equipo.
create or replace function public.funcion_ocupacion(p_funcion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.funcion_funciones;
  c public.funcion_campanas;
  v_experiencia text;
  v_ocupadas integer;
begin
  select * into f from public.funcion_funciones where id = p_funcion_id;
  if not found then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  perform public.funcion_actor(f.workspace_id, false, 'funcion_no_existe');
  select * into c from public.funcion_campanas where id = f.campana_id;
  select nombre into v_experiencia from public.funcion_experiencias where id = c.experiencia_id;

  v_ocupadas := public.funcion_ocupadas(f.id);
  return jsonb_build_object(
    'funcion_id', f.id,
    'workspace_id', f.workspace_id,
    'campana_id', c.id,
    'campana', c.nombre,
    'campana_codigo', c.codigo,
    'experiencia_id', c.experiencia_id,
    'experiencia', v_experiencia,
    'inicia_at', f.inicia_at,
    'estado', f.estado,
    'cierra_venta_at', f.cierra_venta_at,
    'archivada', f.archivada_at is not null,
    'capacidad', f.capacidad,
    'cupo_asistente', f.cupo_asistente,
    'ocupadas', v_ocupadas,
    'libres', greatest(f.capacidad - v_ocupadas, 0),
    'libres_asistente', greatest(f.cupo_asistente - v_ocupadas, 0),
    'disponible_asistente', public.funcion_motivo_asistente(f, c) is null,
    'motivo_asistente', public.funcion_motivo_asistente(f, c),
    'tarifa', public.funcion_tarifa(f.id)
  );
end;
$$;

-- ejecutable-por-cliente: la leen las pantallas con la sesión del equipo. Es SECURITY DEFINER y verifica que
-- `auth.uid()` esté en el workspace de la función (`funcion_actor`); con otro workspace responde `funcion_no_existe`.
revoke execute on function public.funcion_ocupacion(uuid) from public, anon;
grant execute on function public.funcion_ocupacion(uuid) to authenticated, service_role;

-- Lo que ve el asistente de UNA función: si está disponible (y por qué no), lo libre DEL ASISTENTE (nunca la
-- capacidad ni datos de otras reservas) y la tarifa que rige. Una función de una campaña sin publicar «no existe».
create or replace function public.funcion_consultar_cupo(p_workspace_id uuid, p_funcion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.funcion_funciones;
  c public.funcion_campanas;
  v_motivo text;
begin
  select * into f from public.funcion_funciones where id = p_funcion_id and workspace_id = p_workspace_id;
  if not found then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  select * into c from public.funcion_campanas where id = f.campana_id;
  v_motivo := public.funcion_motivo_asistente(f, c);
  if v_motivo in ('campana_no_publicada', 'funcion_archivada') then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'funcion_id', f.id,
    'campana_codigo', c.codigo,
    'inicia_at', f.inicia_at,
    'disponible', v_motivo is null,
    'motivo', v_motivo,
    'cupo_libre', case when v_motivo is null then greatest(f.cupo_asistente - public.funcion_ocupadas(f.id), 0) else 0 end,
    'agotada', v_motivo = 'agotada',
    'tarifa', public.funcion_tarifa(f.id)
  );
end;
$$;

-- server-only: la llama solo el asistente con la llave de servicio.
revoke execute on function public.funcion_consultar_cupo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.funcion_consultar_cupo(uuid, uuid) to service_role;

-- Las funciones que el asistente puede ofrecer, con su tarifa, en orden de hora. Con `p_codigo_campana`, solo las de
-- esa campaña (sin distinguir mayúsculas). Solo lectura.
create or replace function public.funcion_ver_disponibles(p_workspace_id uuid, p_codigo_campana text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'funcion_id', f.id,
           'campana_codigo', c.codigo,
           'campana', c.nombre,
           'experiencia', e.nombre,
           'inicia_at', f.inicia_at,
           'cupo_libre', greatest(f.cupo_asistente - public.funcion_ocupadas(f.id), 0),
           'tarifa', public.funcion_tarifa(f.id)
         ) order by f.inicia_at, f.id), '[]'::jsonb)
    from public.funcion_funciones f
    join public.funcion_campanas c on c.id = f.campana_id
    join public.funcion_experiencias e on e.id = c.experiencia_id
   where f.workspace_id = p_workspace_id
     and (p_codigo_campana is null or c.codigo = upper(btrim(p_codigo_campana)))
     and public.funcion_motivo_asistente(f, c) is null;
$$;

-- server-only: la llama solo el asistente con la llave de servicio.
revoke execute on function public.funcion_ver_disponibles(uuid, text) from public, anon, authenticated;
grant execute on function public.funcion_ver_disponibles(uuid, text) to service_role;

-- Las campañas con agenda publicada y activas, con cuántas funciones disponibles tiene cada una: si hay más de una, el
-- asistente pregunta a qué viene el cliente. Solo lectura.
create or replace function public.funcion_campanas_activas(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with activas as (
    select c.id, c.codigo, c.nombre, e.nombre as experiencia, c.desde, c.hasta,
           (select count(*)::integer from public.funcion_funciones f
             where f.campana_id = c.id and public.funcion_motivo_asistente(f, c) is null) as funciones_disponibles
      from public.funcion_campanas c
      join public.funcion_experiencias e on e.id = c.experiencia_id
     where c.workspace_id = p_workspace_id and c.estado = 'activa'
       and c.agenda_publicada_at is not null and c.archivada_at is null
  )
  select jsonb_build_object(
    'total', (select count(*) from activas),
    'campanas', coalesce((select jsonb_agg(jsonb_build_object(
        'campana_id', id, 'codigo', codigo, 'nombre', nombre, 'experiencia', experiencia,
        'desde', desde, 'hasta', hasta, 'funciones_disponibles', funciones_disponibles) order by codigo) from activas), '[]'::jsonb)
  );
$$;

-- server-only: la llama solo el asistente con la llave de servicio.
revoke execute on function public.funcion_campanas_activas(uuid) from public, anon, authenticated;
grant execute on function public.funcion_campanas_activas(uuid) to service_role;


-- ── 11. Apartar ──────────────────────────────────────────────────────────────

-- Datos admitidos en `p_datos`. A propósito NO hay campo de mesa, de puesto ni de MONTO: una clave de más (`mesa_id`,
-- `puesto`, `monto_total`, `precio`…) se rechaza con `dato_no_admitido`. El monto lo calcula la base con
-- `funcion_tarifa` y queda como foto en la reserva.
-- `p_modalidad`: `abono` (exige abono por persona) o `total` (exige que se permita el pago total); si no,
-- `modalidad_no_permitida`. Sin precio que rija: `sin_precio`, y no aparta.
-- Origen `asistente`: la función tiene que estar disponible (`funcion_motivo_asistente`, salvo «agotada», que se
-- decide con las personas) y las personas caber en `cupo_asistente`. Origen `equipo`: puede apartar en una campaña
-- pausada o en borrador y en una función pausada; las personas caben en `capacidad`. Las dos contra la misma suma.
create or replace function public.funcion_apartar(
  p_workspace_id uuid,
  p_funcion_id uuid,
  p_personas integer,
  p_modalidad text,
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
  f public.funcion_funciones;
  c public.funcion_campanas;
  r record;
  v_motivo text;
  v_ocupadas integer;
  v_cuenta bigint;
  v_conv bigint;
  v_canal text;
  v_fuente text;
  v_ultima text;
  v_nombre text;
  v_tel text;
  v_contacto uuid;
  v_id uuid;
  v_vence timestamptz;
  v_tarifa jsonb;
  v_precio integer;
  v_abono integer;
  v_limite integer;
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
                         'chatwoot_cuenta_id', 'chatwoot_conversacion_id', 'solicitud_cliente',
                         'atribucion_fuente', 'atribucion_ref'])
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
  v_fuente := coalesce(nullif(btrim(v_datos->>'atribucion_fuente'), ''), case v_actor when 'equipo' then 'equipo' else 'desconocida' end);
  if v_fuente not in ('anuncio', 'link_campana', 'preguntado', 'equipo', 'desconocida') then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'atribucion_fuente';
  end if;

  -- El candado de la función: todo lo que sigue ve la ocupación quieta.
  select * into f from public.funcion_funciones
   where id = p_funcion_id and workspace_id = p_workspace_id
   for update;
  if not found then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  perform public.funcion_vencer_apartados(f.id);
  select * into c from public.funcion_campanas where id = f.campana_id;

  -- Misma clave = la misma reserva y la misma foto, sin volver a contar (aunque el precio haya cambiado).
  select * into r from public.funcion_reservas
   where workspace_id = p_workspace_id and clave_idempotencia = v_clave;
  if found then
    if r.funcion_id <> f.id or r.personas <> p_personas or r.modalidad is distinct from p_modalidad then
      raise exception 'clave_reusada' using errcode = 'P0001',
        detail = 'La clave ya se usó para otra función, otro número de personas u otra modalidad.';
    end if;
    return jsonb_build_object('reserva_id', r.id, 'estado', r.estado, 'vence_at', r.vence_at, 'repetida', true,
      'campana_id', r.campana_id, 'tarifa', r.tarifa, 'precio_unitario', r.precio_unitario,
      'monto_total', r.monto_total, 'modalidad', r.modalidad, 'monto_a_pagar', r.monto_a_pagar);
  end if;

  if v_actor = 'servidor' then
    v_motivo := public.funcion_motivo_asistente(f, c);
    if v_motivo in ('campana_no_publicada', 'funcion_archivada') then
      raise exception 'funcion_no_existe' using errcode = 'P0001';
    end if;
    if v_motivo is not null and v_motivo <> 'agotada' then
      raise exception '%', v_motivo using errcode = 'P0001';
    end if;
  else
    if f.archivada_at is not null or c.archivada_at is not null or f.estado = 'cancelada' or c.estado = 'cerrada'
       or f.inicia_at <= now() then
      raise exception 'funcion_cerrada' using errcode = 'P0001';
    end if;
    if f.cierra_venta_at is not null and f.cierra_venta_at <= now() then
      raise exception 'venta_cerrada' using errcode = 'P0001';
    end if;
  end if;
  if c.minutos_apartado is null then
    raise exception 'sin_regla_apartado' using errcode = 'P0001',
      detail = 'La campaña no tiene definido cuánto dura un apartado sin pago.';
  end if;

  if v_actor = 'servidor' then
    if v_canal is null or v_canal not in ('instagram', 'tiktok', 'whatsapp', 'otro') then
      raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'canal';
    end if;
    if v_cuenta is null or v_conv is null then
      raise exception 'sin_autorizacion' using errcode = 'P0001';
    end if;
    -- La última respuesta de la conversación manda: un «no» después de un «sí» retira la autorización.
    select x.respuesta into v_ultima
      from public.chatwoot_consentimientos x
     where x.workspace_id = p_workspace_id and x.cuenta_id = v_cuenta and x.conversacion_id = v_conv
       and x.tipo = 'general'
     order by x.created_at desc, x.id desc
     limit 1;
    if v_ultima is distinct from 'si' then
      raise exception 'sin_autorizacion' using errcode = 'P0001';
    end if;
  elsif v_canal not in ('instagram', 'tiktok', 'whatsapp', 'otro', 'equipo') then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'canal';
  end if;

  -- El precio que rige y la modalidad, antes de contar cupo.
  v_tarifa := public.funcion_tarifa(f.id);
  v_precio := (v_tarifa->>'precio_persona')::integer;
  if v_precio is null then
    raise exception 'sin_precio' using errcode = 'P0001', detail = 'La función no tiene precio por persona.';
  end if;
  if p_modalidad = 'abono' and (v_tarifa->>'abono_persona') is not null then
    v_abono := (v_tarifa->>'abono_persona')::integer;
  elsif p_modalidad = 'total' and (v_tarifa->>'permite_pago_total')::boolean then
    v_abono := null;
  else
    raise exception 'modalidad_no_permitida' using errcode = 'P0001',
      detail = format('Abono por persona: %s; pago total: %s.', coalesce(v_tarifa->>'abono_persona', 'no'),
                      case when (v_tarifa->>'permite_pago_total')::boolean then 'sí' else 'no' end);
  end if;

  v_ocupadas := public.funcion_ocupadas(f.id);
  v_limite := case when p_origen = 'asistente' then f.cupo_asistente else f.capacidad end;
  if v_ocupadas + p_personas > v_limite then
    raise exception 'sin_cupo' using errcode = 'P0001',
      detail = format('Quedan %s puestos.', greatest(v_limite - v_ocupadas, 0));
  end if;

  -- El cliente en la base de clientes: por teléfono, y si no está y hay nombre, se crea.
  v_nombre := nullif(btrim(v_datos->>'nombre'), '');
  v_tel := public.limpiar_telefono(nullif(btrim(v_datos->>'telefono'), ''));
  if v_tel is not null and v_tel <> '' and public.telefono_valido(v_tel) then
    select ct.id into v_contacto from public.contactos ct
     where ct.workspace_id = p_workspace_id and ct.telefono = v_tel
     order by ct.created_at nulls last, ct.id
     limit 1;
    if v_contacto is null and v_nombre is not null then
      insert into public.contactos (workspace_id, nombre, telefono)
      values (p_workspace_id, left(v_nombre, 200), v_tel)
      returning id into v_contacto;
    end if;
  else
    v_tel := null;
  end if;

  v_vence := now() + make_interval(mins => c.minutos_apartado);
  insert into public.funcion_reservas (
    workspace_id, funcion_id, campana_id, personas, contacto_id, nombre, documento, telefono, contacto_canal, canal,
    chatwoot_cuenta_id, chatwoot_conversacion_id, atribucion_fuente, atribucion_ref, estado, vence_at,
    solicitud_cliente, origen, clave_idempotencia, creada_por,
    tarifa, precio_unitario, monto_total, modalidad, abono_unitario, monto_a_pagar
  ) values (
    p_workspace_id, f.id, f.campana_id, p_personas, v_contacto, v_nombre, nullif(btrim(v_datos->>'documento'), ''), v_tel,
    nullif(btrim(v_datos->>'contacto_canal'), ''), v_canal, v_cuenta, v_conv, v_fuente,
    left(nullif(btrim(v_datos->>'atribucion_ref'), ''), 200), 'apartada', v_vence,
    left(nullif(btrim(v_datos->>'solicitud_cliente'), ''), 500), p_origen, v_clave, auth.uid(),
    v_tarifa->>'tarifa', v_precio, p_personas::bigint * v_precio, p_modalidad, v_abono,
    p_personas::bigint * coalesce(v_abono, v_precio)
  ) returning id into v_id;

  return jsonb_build_object('reserva_id', v_id, 'estado', 'apartada', 'vence_at', v_vence, 'repetida', false,
    'campana_id', f.campana_id, 'tarifa', v_tarifa->>'tarifa', 'precio_unitario', v_precio,
    'monto_total', p_personas::bigint * v_precio, 'modalidad', p_modalidad,
    'monto_a_pagar', p_personas::bigint * coalesce(v_abono, v_precio));
end;
$$;

-- ejecutable-por-cliente: la usa el equipo con su sesión (origen equipo) y el asistente con service_role (origen
-- asistente). SECURITY DEFINER: con sesión exige que `auth.uid()` esté en el workspace y tenga rol que edite.
revoke execute on function public.funcion_apartar(uuid, uuid, integer, text, jsonb, text, text) from public, anon;
grant execute on function public.funcion_apartar(uuid, uuid, integer, text, jsonb, text, text) to authenticated, service_role;


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
  v_limite integer;
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
  -- Un apartado vencido ya no ocupaba: solo se confirma si cabe en el límite de SU origen (el del asistente para lo
  -- que apartó el asistente, la capacidad para lo del equipo). Nunca por encima.
  if r.estado = 'vencida' then
    v_ocupadas := public.funcion_ocupadas(f.id);
    v_limite := case when r.origen = 'asistente' then f.cupo_asistente else f.capacidad end;
    if v_ocupadas + r.personas > v_limite then
      raise exception 'sin_cupo' using errcode = 'P0001',
        detail = format('El apartado venció y quedan %s puestos.', greatest(v_limite - v_ocupadas, 0));
    end if;
  end if;

  update public.funcion_reservas
     set estado = 'confirmada', pago_estado = p_pago_estado, confirmada_at = now(), confirmada_por = auth.uid(),
         updated_at = now()
   where id = r.id;
  return jsonb_build_object('reserva_id', r.id, 'estado', 'confirmada', 'pago_estado', p_pago_estado, 'repetida', false,
    'monto_a_pagar', r.monto_a_pagar);
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

  update public.funcion_reservas
     set estado = 'cancelada', cancelada_at = now(), cancelada_por = auth.uid(), updated_at = now()
   where id = r.id;
  return jsonb_build_object('reserva_id', r.id, 'estado', 'cancelada', 'repetida', false);
end;
$$;

-- ejecutable-por-cliente: solo el equipo, con su sesión. SECURITY DEFINER; exige sesión del workspace de la reserva.
revoke execute on function public.funcion_cancelar_reserva(uuid) from public, anon, service_role;
grant execute on function public.funcion_cancelar_reserva(uuid) to authenticated;


-- ── 13. Restricciones alimentarias (dato sensible) ───────────────────────────

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


-- ── 14. Alta y agenda desde ONE (la única puerta; solo el equipo) ────────────
-- Nada de esto se concede a service_role: el asistente lee, no da de alta.

-- Un número de pesos de un jsonb de precios: entero 1..100.000.000, o nulo. Si no, `precio_invalido`.
create or replace function public.funcion_precio_de(p jsonb, k text)
returns integer
language plpgsql
immutable
set search_path = public
as $$
begin
  if p is null or not (p ? k) or jsonb_typeof(p->k) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p->k) <> 'number' or (p->>k) !~ '^[0-9]{1,9}$' or (p->>k)::integer not between 1 and 100000000 then
    raise exception 'precio_invalido' using errcode = 'P0001', detail = k;
  end if;
  return (p->>k)::integer;
end;
$$;

revoke execute on function public.funcion_precio_de(jsonb, text) from public, anon, authenticated, service_role;

-- Los precios que acepta un jsonb (`p_precios`), y nada más.
create or replace function public.funcion_validar_precios(p jsonb, p_admitidas text[])
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_extra text;
begin
  if p is null then
    return;
  end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'precio_invalido' using errcode = 'P0001';
  end if;
  select k into v_extra from jsonb_object_keys(p) k where k <> all (p_admitidas) limit 1;
  if v_extra is not null then
    raise exception 'dato_no_admitido' using errcode = 'P0001', detail = v_extra;
  end if;
  if p ? 'permite_pago_total' and jsonb_typeof(p->'permite_pago_total') not in ('boolean', 'null') then
    raise exception 'precio_invalido' using errcode = 'P0001', detail = 'permite_pago_total';
  end if;
  if p ? 'es_preventa' and jsonb_typeof(p->'es_preventa') <> 'boolean' then
    raise exception 'precio_invalido' using errcode = 'P0001', detail = 'es_preventa';
  end if;
end;
$$;

revoke execute on function public.funcion_validar_precios(jsonb, text[]) from public, anon, authenticated, service_role;

create or replace function public.funcion_guardar_experiencia(
  p_workspace_id uuid,
  p_experiencia_id uuid,
  p_nombre text,
  p_historia text,
  p_que_incluye text,
  p_edad_minima integer,
  p_info_general text
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
  if p_edad_minima is not null and (p_edad_minima < 0 or p_edad_minima > 99) then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'edad_minima';
  end if;

  if p_experiencia_id is null then
    insert into public.funcion_experiencias (workspace_id, nombre, historia, que_incluye, edad_minima, info_general)
    values (p_workspace_id, v_nombre, nullif(btrim(coalesce(p_historia, '')), ''), nullif(btrim(coalesce(p_que_incluye, '')), ''),
            p_edad_minima, nullif(btrim(coalesce(p_info_general, '')), ''))
    returning id into v_id;
  else
    update public.funcion_experiencias
       set nombre = v_nombre, historia = nullif(btrim(coalesce(p_historia, '')), ''),
           que_incluye = nullif(btrim(coalesce(p_que_incluye, '')), ''), edad_minima = p_edad_minima,
           info_general = nullif(btrim(coalesce(p_info_general, '')), ''), updated_at = now()
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
revoke execute on function public.funcion_guardar_experiencia(uuid, uuid, text, text, text, integer, text) from public, anon, service_role;
grant execute on function public.funcion_guardar_experiencia(uuid, uuid, text, text, text, integer, text) to authenticated;

-- Crea (p_campana_id nulo) o edita una campaña. `p_precios` = {precio_persona, precio_preventa_persona, abono_persona,
-- permite_pago_total}. El código se guarda en mayúsculas y no cambia después de publicar. `activa` solo con la agenda
-- publicada (para eso está `funcion_publicar_agenda`).
create or replace function public.funcion_guardar_campana(
  p_workspace_id uuid,
  p_campana_id uuid,
  p_experiencia_id uuid,
  p_nombre text,
  p_codigo text,
  p_desde date,
  p_hasta date,
  p_estado text,
  p_minutos_apartado integer,
  p_precios jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_estado text := coalesce(p_estado, 'borrador');
  v_precio integer;
  v_preventa integer;
  v_abono integer;
  v_permite boolean;
  v_publicada timestamptz;
  v_id uuid;
begin
  if public.funcion_actor(p_workspace_id, true, 'campana_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  if v_nombre is null or length(v_nombre) > 200 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'nombre';
  end if;
  if v_codigo !~ '^[A-Z0-9][A-Z0-9-]{1,19}$' then
    raise exception 'codigo_invalido' using errcode = 'P0001',
      detail = 'Entre 2 y 20 letras, números o guiones, sin espacios (por ejemplo HP-OCT26).';
  end if;
  if v_estado not in ('borrador', 'activa', 'pausada', 'cerrada') then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'estado';
  end if;
  if p_minutos_apartado is not null and (p_minutos_apartado < 1 or p_minutos_apartado > 10080) then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'minutos_apartado';
  end if;
  if p_desde is not null and p_hasta is not null and p_hasta < p_desde then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'fechas';
  end if;
  if not exists (select 1 from public.funcion_experiencias where id = p_experiencia_id and workspace_id = p_workspace_id) then
    raise exception 'experiencia_no_existe' using errcode = 'P0001';
  end if;
  perform public.funcion_validar_precios(p_precios, array['precio_persona', 'precio_preventa_persona', 'abono_persona', 'permite_pago_total']);
  v_precio := public.funcion_precio_de(p_precios, 'precio_persona');
  v_preventa := public.funcion_precio_de(p_precios, 'precio_preventa_persona');
  v_abono := public.funcion_precio_de(p_precios, 'abono_persona');
  v_permite := coalesce((p_precios->>'permite_pago_total')::boolean, true);
  if exists (select 1 from public.funcion_campanas
              where workspace_id = p_workspace_id and codigo = v_codigo and id is distinct from p_campana_id) then
    raise exception 'codigo_repetido' using errcode = 'P0001', detail = v_codigo;
  end if;

  if p_campana_id is null then
    if v_estado = 'activa' then
      raise exception 'campana_no_publicada' using errcode = 'P0001', detail = 'Se activa al publicar la agenda.';
    end if;
    insert into public.funcion_campanas (workspace_id, experiencia_id, nombre, codigo, desde, hasta, estado,
      minutos_apartado, precio_persona, precio_preventa_persona, abono_persona, permite_pago_total)
    values (p_workspace_id, p_experiencia_id, v_nombre, v_codigo, p_desde, p_hasta, v_estado,
      p_minutos_apartado, v_precio, v_preventa, v_abono, v_permite)
    returning id into v_id;
  else
    select agenda_publicada_at into v_publicada from public.funcion_campanas
     where id = p_campana_id and workspace_id = p_workspace_id and archivada_at is null
     for update;
    if not found then
      raise exception 'campana_no_existe' using errcode = 'P0001';
    end if;
    if v_estado = 'activa' and v_publicada is null then
      raise exception 'campana_no_publicada' using errcode = 'P0001', detail = 'Se activa al publicar la agenda.';
    end if;
    update public.funcion_campanas
       set experiencia_id = p_experiencia_id, nombre = v_nombre, codigo = v_codigo, desde = p_desde, hasta = p_hasta,
           estado = v_estado, minutos_apartado = p_minutos_apartado, precio_persona = v_precio,
           precio_preventa_persona = v_preventa, abono_persona = v_abono, permite_pago_total = v_permite
     where id = p_campana_id;
    v_id := p_campana_id;
  end if;
  return v_id;
end;
$$;

-- ejecutable-por-cliente: el panel del equipo, con su sesión. SECURITY DEFINER; exige el workspace y rol que edite.
revoke execute on function public.funcion_guardar_campana(uuid, uuid, uuid, text, text, date, date, text, integer, jsonb) from public, anon, service_role;
grant execute on function public.funcion_guardar_campana(uuid, uuid, uuid, text, text, date, date, text, integer, jsonb) to authenticated;

-- Publica la agenda: marca `agenda_publicada_at` (la primera vez) y deja la campaña `activa`. Exige al menos una
-- función futura y viva, y que todas las futuras y vivas tengan precio resuelto (`funcion_tarifa`). Antes de esto,
-- nada de la campaña es visible para el asistente.
create or replace function public.funcion_publicar_agenda(p_campana_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_sin_precio integer;
  v_funciones integer;
begin
  select * into c from public.funcion_campanas where id = p_campana_id;
  if not found then
    raise exception 'campana_no_existe' using errcode = 'P0001';
  end if;
  if public.funcion_actor(c.workspace_id, true, 'campana_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  select * into c from public.funcion_campanas where id = p_campana_id for update;
  if c.archivada_at is not null or c.estado = 'cerrada' then
    raise exception 'campana_cerrada' using errcode = 'P0001';
  end if;

  select count(*)::integer,
         count(*) filter (where (public.funcion_tarifa(f.id)->>'precio_persona') is null)::integer
    into v_funciones, v_sin_precio
    from public.funcion_funciones f
   where f.campana_id = c.id and f.inicia_at > now() and f.estado <> 'cancelada' and f.archivada_at is null;
  if v_funciones = 0 then
    raise exception 'campana_sin_funciones' using errcode = 'P0001', detail = 'Agrega al menos una función futura.';
  end if;
  if v_sin_precio > 0 then
    raise exception 'funcion_sin_precio' using errcode = 'P0001',
      detail = format('%s función(es) sin precio por persona.', v_sin_precio);
  end if;

  update public.funcion_campanas
     set agenda_publicada_at = coalesce(agenda_publicada_at, now()), estado = 'activa'
   where id = c.id;
  return jsonb_build_object('campana_id', c.id, 'funciones', v_funciones, 'estado', 'activa');
end;
$$;

-- ejecutable-por-cliente: el panel del equipo, con su sesión. SECURITY DEFINER; exige el workspace y rol que edite.
revoke execute on function public.funcion_publicar_agenda(uuid) from public, anon, service_role;
grant execute on function public.funcion_publicar_agenda(uuid) to authenticated;

-- La agenda en lote: una función por cada par EXPLÍCITO fecha + hora de Bogotá,
--   p_horarios = [{"fecha": "2026-10-24", "hora": "13:00"}, …]
-- Nunca horas sueltas aplicadas a varios días. Un par repetido en la lista, o que ya existe vivo en la campaña:
-- `horario_repetido`. Todas con la misma capacidad, cupo del asistente, cierre de venta y `p_precios` = {es_preventa,
-- precio_persona, precio_preventa_persona, abono_persona, permite_pago_total} (reemplazos de la campaña). Todo o nada.
create or replace function public.funcion_crear_funciones(
  p_workspace_id uuid,
  p_campana_id uuid,
  p_capacidad integer,
  p_cupo_asistente integer,
  p_cierre_minutos_antes integer,
  p_precios jsonb,
  p_horarios jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_horarios jsonb := coalesce(p_horarios, '[]'::jsonb);
  v_item jsonb;
  v_inicio timestamptz;
  v_inicios timestamptz[] := '{}';
  v_ids jsonb := '[]'::jsonb;
  v_id uuid;
  v_cupo_asistente integer := coalesce(p_cupo_asistente, p_capacidad);
  c record;
begin
  if public.funcion_actor(p_workspace_id, true, 'campana_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  select * into c from public.funcion_campanas
   where id = p_campana_id and workspace_id = p_workspace_id and archivada_at is null;
  if not found then
    raise exception 'campana_no_existe' using errcode = 'P0001';
  end if;
  if c.estado = 'cerrada' then
    raise exception 'campana_cerrada' using errcode = 'P0001';
  end if;
  if p_capacidad is null or p_capacidad < 1 or p_capacidad > 10000 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'capacidad';
  end if;
  if v_cupo_asistente < 1 or v_cupo_asistente > p_capacidad then
    raise exception 'cupo_asistente_invalido' using errcode = 'P0001',
      detail = format('El cupo del asistente va de 1 a la capacidad (%s).', p_capacidad);
  end if;
  if p_cierre_minutos_antes is not null and (p_cierre_minutos_antes < 0 or p_cierre_minutos_antes > 20160) then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'cierre de venta';
  end if;
  perform public.funcion_validar_precios(p_precios,
    array['es_preventa', 'precio_persona', 'precio_preventa_persona', 'abono_persona', 'permite_pago_total']);
  if jsonb_typeof(v_horarios) <> 'array' or jsonb_array_length(v_horarios) = 0 or jsonb_array_length(v_horarios) > 60 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'Entre 1 y 60 pares de fecha y hora.';
  end if;

  for v_item in select value from jsonb_array_elements(v_horarios) loop
    if jsonb_typeof(v_item) <> 'object'
       or (select count(*) from jsonb_object_keys(v_item)) <> 2
       or coalesce(v_item->>'fecha', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_item->>'hora', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
      raise exception 'horario_invalido' using errcode = 'P0001',
        detail = 'Cada función es un par explícito {fecha: AAAA-MM-DD, hora: HH:MM}.';
    end if;
    begin
      v_inicio := ((v_item->>'fecha') || ' ' || (v_item->>'hora'))::timestamp at time zone 'America/Bogota';
    exception when others then
      raise exception 'horario_invalido' using errcode = 'P0001', detail = v_item::text;
    end;
    if v_inicio = any (v_inicios) or exists (
      select 1 from public.funcion_funciones where campana_id = c.id and inicia_at = v_inicio and archivada_at is null
    ) then
      raise exception 'horario_repetido' using errcode = 'P0001',
        detail = format('%s %s', v_item->>'fecha', v_item->>'hora');
    end if;
    if v_inicio <= now() then
      raise exception 'fecha_pasada' using errcode = 'P0001', detail = format('%s %s', v_item->>'fecha', v_item->>'hora');
    end if;
    v_inicios := v_inicios || v_inicio;
  end loop;

  foreach v_inicio in array v_inicios loop
    insert into public.funcion_funciones (workspace_id, campana_id, inicia_at, capacidad, cupo_asistente, cierra_venta_at,
      es_preventa, precio_persona, precio_preventa_persona, abono_persona, permite_pago_total)
    values (p_workspace_id, c.id, v_inicio, p_capacidad, v_cupo_asistente,
      case when p_cierre_minutos_antes is null then null else v_inicio - make_interval(mins => p_cierre_minutos_antes) end,
      coalesce((p_precios->>'es_preventa')::boolean, false),
      public.funcion_precio_de(p_precios, 'precio_persona'), public.funcion_precio_de(p_precios, 'precio_preventa_persona'),
      public.funcion_precio_de(p_precios, 'abono_persona'), (p_precios->>'permite_pago_total')::boolean)
    returning id into v_id;
    v_ids := v_ids || to_jsonb(v_id);
  end loop;
  return v_ids;
end;
$$;

-- ejecutable-por-cliente: el panel del equipo, con su sesión. SECURITY DEFINER; exige el workspace.
revoke execute on function public.funcion_crear_funciones(uuid, uuid, integer, integer, integer, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.funcion_crear_funciones(uuid, uuid, integer, integer, integer, jsonb, jsonb) to authenticated;

-- Cambia los cupos, el estado, el cierre de venta y (si `p_precios` no es nulo) los reemplazos de precio de una
-- función, con el candado de la función tomado (la capacidad no baja de lo ocupado: lo dice el trigger; la tarifa
-- tiene que cuadrar).
create or replace function public.funcion_editar_funcion(
  p_funcion_id uuid,
  p_capacidad integer,
  p_cupo_asistente integer,
  p_estado text,
  p_cierra_venta_at timestamptz,
  p_precios jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.funcion_funciones where id = p_funcion_id and archivada_at is null;
  if not found then
    raise exception 'funcion_no_existe' using errcode = 'P0001';
  end if;
  if public.funcion_actor(v_ws, true, 'funcion_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  if coalesce(p_estado, '') not in ('activa', 'pausada', 'cancelada') then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'estado';
  end if;
  if p_capacidad is null or p_capacidad < 1 or p_capacidad > 10000 then
    raise exception 'datos_invalidos' using errcode = 'P0001', detail = 'capacidad';
  end if;
  if p_cupo_asistente is null or p_cupo_asistente < 1 or p_cupo_asistente > p_capacidad then
    raise exception 'cupo_asistente_invalido' using errcode = 'P0001',
      detail = format('El cupo del asistente va de 1 a la capacidad (%s).', p_capacidad);
  end if;
  perform public.funcion_validar_precios(p_precios,
    array['es_preventa', 'precio_persona', 'precio_preventa_persona', 'abono_persona', 'permite_pago_total']);

  perform 1 from public.funcion_funciones where id = p_funcion_id for update;
  perform public.funcion_vencer_apartados(p_funcion_id);
  update public.funcion_funciones
     set capacidad = p_capacidad, cupo_asistente = p_cupo_asistente, estado = p_estado, cierra_venta_at = p_cierra_venta_at
   where id = p_funcion_id;
  -- `p_precios` nulo = los reemplazos de precio no se tocan.
  if p_precios is not null then
    update public.funcion_funciones
       set es_preventa = coalesce((p_precios->>'es_preventa')::boolean, false),
           precio_persona = public.funcion_precio_de(p_precios, 'precio_persona'),
           precio_preventa_persona = public.funcion_precio_de(p_precios, 'precio_preventa_persona'),
           abono_persona = public.funcion_precio_de(p_precios, 'abono_persona'),
           permite_pago_total = (p_precios->>'permite_pago_total')::boolean
     where id = p_funcion_id;
  end if;
  return public.funcion_ocupacion(p_funcion_id);
end;
$$;

-- ejecutable-por-cliente: el equipo con su sesión. SECURITY DEFINER; exige el workspace de la función.
revoke execute on function public.funcion_editar_funcion(uuid, integer, integer, text, timestamptz, jsonb) from public, anon, service_role;
grant execute on function public.funcion_editar_funcion(uuid, integer, integer, text, timestamptz, jsonb) to authenticated;

-- Eliminar una función: si tiene reservas (de cualquier estado: son historia y atribución), se ARCHIVA; si no, se borra.
-- Una archivada no se lista ni se vende.
create or replace function public.funcion_eliminar_funcion(p_funcion_id uuid)
returns text
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
  perform 1 from public.funcion_funciones where id = p_funcion_id for update;
  if exists (select 1 from public.funcion_reservas where funcion_id = p_funcion_id) then
    update public.funcion_funciones set archivada_at = coalesce(archivada_at, now()) where id = p_funcion_id;
    return 'archivada';
  end if;
  delete from public.funcion_funciones where id = p_funcion_id;
  return 'borrada';
end;
$$;

-- ejecutable-por-cliente: el panel del equipo, con su sesión. SECURITY DEFINER; exige el workspace.
revoke execute on function public.funcion_eliminar_funcion(uuid) from public, anon, service_role;
grant execute on function public.funcion_eliminar_funcion(uuid) to authenticated;

-- Eliminar una campaña: si alguna de sus funciones tiene reservas, se archivan la campaña y sus funciones; si no, se
-- borran sus funciones y la campaña.
create or replace function public.funcion_eliminar_campana(p_campana_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.funcion_campanas where id = p_campana_id;
  if not found then
    raise exception 'campana_no_existe' using errcode = 'P0001';
  end if;
  if public.funcion_actor(v_ws, true, 'campana_no_existe') <> 'equipo' then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  -- Orden de candados: las funciones primero (las de la campaña, en orden), luego la campaña.
  perform 1 from public.funcion_funciones where campana_id = p_campana_id order by id for update;
  perform 1 from public.funcion_campanas where id = p_campana_id for update;
  if exists (select 1 from public.funcion_reservas where campana_id = p_campana_id) then
    update public.funcion_funciones set archivada_at = coalesce(archivada_at, now()) where campana_id = p_campana_id;
    update public.funcion_campanas set archivada_at = coalesce(archivada_at, now()) where id = p_campana_id;
    return 'archivada';
  end if;
  delete from public.funcion_funciones where campana_id = p_campana_id;
  delete from public.funcion_campanas where id = p_campana_id;
  return 'borrada';
end;
$$;

-- ejecutable-por-cliente: el panel del equipo, con su sesión. SECURITY DEFINER; exige el workspace.
revoke execute on function public.funcion_eliminar_campana(uuid) from public, anon, service_role;
grant execute on function public.funcion_eliminar_campana(uuid) to authenticated;
