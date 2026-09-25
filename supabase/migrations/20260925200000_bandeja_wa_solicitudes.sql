-- ============================================================
-- 20260925200000 — Bandeja de mensajes entrantes por WhatsApp (solicitudes de viaje)
-- Diseño: proyectos/trappvel/clarity/docs/diseno/motor-solicitud-viaje.md, §2 pasos 2 a 4
-- y §3 paso 1 (ingesta). Encargo: brief-max-bandeja-wa-solicitud.md (2026-09-25).
--
-- QUÉ RESUELVE: el bot solo dejaba una bitácora de 100 caracteres (`wa_message_log`). Un
-- comercial que reenvía la conversación con su cliente no dejaba nada utilizable. Aquí queda
-- el mensaje COMPLETO, con su workspace, su remitente, el id de Meta, el tipo, si venía
-- reenviado, y agrupado en ENTREGAS: una ráfaga de reenvíos seguidos es una sola solicitud.
--
-- POR QUÉ NO `contacto_interacciones`: esa tabla exige `contacto_id NOT NULL`, y al entrar el
-- mensaje todavía no se sabe de qué cliente es (el cliente viene DENTRO del texto reenviado;
-- quien escribe es el comercial, no el cliente). Además la leen la atribución de marketing y
-- el tablero comercial: meter ahí los reenvíos movería cifras de campañas. Esta es la bandeja
-- PREVIA; el paso de entendimiento la leerá y, cuando sepa el cliente, escribirá donde toque.
--
-- LO QUE HACE:
--   1. `wa_bandeja_entregas`: una fila por entrega (abierta → esperando_cliente → con_cliente).
--      A lo sumo UNA abierta por remitente y workspace (índice único parcial).
--   2. `wa_bandeja_mensajes`: una fila por mensaje, `wa_message_id` único (Meta reintenta).
--   3. `wa_bandeja_registrar_mensaje(...)`: registra y agrupa en UNA transacción, serializada
--      por remitente. Meta manda cada reenvío en un webhook aparte y llegan a la vez: decidir
--      "¿hay entrega abierta?" en TypeScript sobre una lectura previa abriría dos entregas para
--      la misma ráfaga. Un duplicado de Meta no se guarda dos veces ni cuenta dos veces.
--   4. `wa_bandeja_cerrar_vencidas()`: cierra por inactividad, en una sola sentencia, y
--      devuelve lo que cerró para que el bot haga la pregunta. Lo llama `wa-alerts`
--      (acción `bandeja_cierre`) desde el cron de la migración 20260925200100.
--
-- NACE INERTE: nada escribe en estas tablas mientras ningún workspace tenga
-- `modules.bandeja_solicitudes_wa = true`. Encenderlo lo bloquea la autorización de datos
-- que está definiendo Emilio.
--
-- MEDIA: el audio y la imagen NO se suben a storage todavía (dependen de A2, repositorio
-- documental). `media_ruta` nace nula; `meta_media_id` guarda el id de Meta, que es lo único
-- que permite recuperar el archivo después (Meta lo conserva un tiempo limitado).
--
-- Verificación después de aplicar (solo lectura):
--   select relname, relrowsecurity from pg_class
--    where oid in ('public.wa_bandeja_entregas'::regclass, 'public.wa_bandeja_mensajes'::regclass);
--     -> las dos con relrowsecurity = true
--   select has_table_privilege('anon', 'public.wa_bandeja_mensajes', 'select'),
--          has_table_privilege('authenticated', 'public.wa_bandeja_mensajes', 'insert');
--     -> false, false
--   select proname, has_function_privilege('anon', p.oid, 'execute'),
--          has_function_privilege('authenticated', p.oid, 'execute'),
--          has_function_privilege('service_role', p.oid, 'execute')
--     from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'wa_bandeja_%';
--     -> anon false, authenticated false, service_role true en las tres
--   select count(*) from public.wa_bandeja_mensajes;   -> 0
-- ============================================================

-- ── 1. Entregas ──────────────────────────────────────────────────────────────

create table public.wa_bandeja_entregas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  -- Quién reenvió. El teléfono es la llave de agrupación (es lo que identifica al remitente
  -- en el bot); staff o colaborador es lo que `identifyUser` resolvió en ese momento.
  remitente_phone text not null,
  remitente_staff_id uuid references public.staff(id) on delete set null,
  remitente_colaborador_id uuid references public.wa_collaborators(id) on delete set null,

  --   abierta            → recibiendo mensajes
  --   esperando_cliente  → cerrada; se le preguntó (o se intentó) de qué cliente es
  --   con_cliente        → el comercial respondió; lista para el paso de entendimiento
  estado text not null default 'abierta'
    constraint wa_bandeja_entregas_estado check (estado in ('abierta', 'esperando_cliente', 'con_cliente')),

  abierta_at timestamptz not null default now(),
  -- Cuándo llegó el último mensaje. De aquí se mide la inactividad (llegada, no la hora de
  -- Meta: un reenvío trae la hora del mensaje ORIGINAL, que puede ser de hace días).
  ultimo_mensaje_at timestamptz not null default now(),
  -- Mensajes de contenido. No cuenta la palabra de cierre ni la respuesta del cliente.
  n_mensajes integer not null default 0,

  cerrada_at timestamptz,
  motivo_cierre text
    constraint wa_bandeja_entregas_motivo check (motivo_cierre in ('inactividad', 'palabra_cierre')),

  pregunta_enviada_at timestamptz,
  pregunta_error text,

  -- Lo que el comercial contestó a «¿De qué cliente es?», tal cual. No se resuelve a un
  -- contacto aquí: eso es entendimiento, y viene en el siguiente encargo.
  cliente_texto text,
  cliente_respondido_at timestamptz,

  created_at timestamptz not null default now(),

  constraint wa_bandeja_entregas_cierre_coherente check (
    (estado = 'abierta' and cerrada_at is null and motivo_cierre is null)
    or (estado <> 'abierta' and cerrada_at is not null and motivo_cierre is not null)
  )
);

-- A lo sumo una abierta por remitente: es lo que impide partir una ráfaga en dos entregas
-- aunque dos webhooks lleguen en el mismo instante.
create unique index uq_wa_bandeja_entrega_abierta
  on public.wa_bandeja_entregas (workspace_id, remitente_phone)
  where estado = 'abierta';

create index idx_wa_bandeja_entregas_abiertas
  on public.wa_bandeja_entregas (ultimo_mensaje_at)
  where estado = 'abierta';

create index idx_wa_bandeja_entregas_ws
  on public.wa_bandeja_entregas (workspace_id, abierta_at desc);

-- ── 2. Mensajes ──────────────────────────────────────────────────────────────

create table public.wa_bandeja_mensajes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Nula solo para una palabra de cierre que llegó sin nada abierto. Si la entrega se borra
  -- el mensaje se queda: la materia prima no se pierde por limpiar una agrupación.
  entrega_id uuid references public.wa_bandeja_entregas(id) on delete set null,

  -- `wamid` de Meta. Único: Meta reintenta el mismo mensaje si no le respondemos a tiempo.
  wa_message_id text not null
    constraint wa_bandeja_mensajes_wamid unique,

  remitente_phone text not null,
  remitente_staff_id uuid references public.staff(id) on delete set null,
  remitente_colaborador_id uuid references public.wa_collaborators(id) on delete set null,

  -- `messages[].type` tal como lo trae el bot (text, audio, image, interactive, location…).
  -- Sin CHECK a propósito: Meta agrega tipos, y un CHECK haría que el primero nuevo se
  -- perdiera entero en vez de quedar guardado con su tipo.
  tipo text not null,

  --   contenido          → parte de la solicitud
  --   cierre             → la palabra de cierre («listo»)
  --   respuesta_cliente  → la respuesta a «¿De qué cliente es?»
  papel text not null default 'contenido'
    constraint wa_bandeja_mensajes_papel check (papel in ('contenido', 'cierre', 'respuesta_cliente')),

  -- El texto completo: el cuerpo, el pie de la foto o la transcripción del audio.
  cuerpo text,
  cuerpo_origen text
    constraint wa_bandeja_mensajes_origen check
      (cuerpo_origen in ('texto', 'pie_de_foto', 'transcripcion', 'interactivo', 'ubicacion')),

  -- `context.forwarded` / `context.frequently_forwarded` del payload de Meta. Hasta aquí el
  -- bot no los leía: un reenvío llegaba como texto suelto.
  reenviado boolean not null default false,
  reenviado_muchas_veces boolean not null default false,

  -- Id del archivo en Meta (audio, imagen). Con él se puede bajar después.
  meta_media_id text,
  -- Ruta en storage. NULA hasta A2 (repositorio documental).
  media_ruta text,
  -- Si el audio no se pudo transcribir: el mensaje se guarda igual, con el motivo.
  transcripcion_error text,

  -- Hora del mensaje según Meta (para un reenvío, la del reenvío, no la del original).
  enviado_at timestamptz,
  recibido_at timestamptz not null default now()
);

create index idx_wa_bandeja_mensajes_entrega
  on public.wa_bandeja_mensajes (entrega_id, recibido_at);

create index idx_wa_bandeja_mensajes_ws
  on public.wa_bandeja_mensajes (workspace_id, recibido_at desc);

-- ── 3. Permisos ──────────────────────────────────────────────────────────────
-- Escribe SOLO el servidor (el webhook y el cron, con service_role, por las funciones de
-- abajo). El equipo del workspace puede LEER lo suyo: la pantalla que revise una entrega y el
-- paso de entendimiento vendrán encima de esto. Nada para anon.

alter table public.wa_bandeja_entregas enable row level security;
alter table public.wa_bandeja_mensajes enable row level security;

revoke all on public.wa_bandeja_entregas from anon, authenticated;
revoke all on public.wa_bandeja_mensajes from anon, authenticated;

grant select on public.wa_bandeja_entregas to authenticated;
grant select on public.wa_bandeja_mensajes to authenticated;
grant all on public.wa_bandeja_entregas to service_role;
grant all on public.wa_bandeja_mensajes to service_role;

create policy wa_bandeja_entregas_lectura on public.wa_bandeja_entregas
  for select to authenticated
  using (workspace_id = (select public.current_user_workspace_id()));

create policy wa_bandeja_mensajes_lectura on public.wa_bandeja_mensajes
  for select to authenticated
  using (workspace_id = (select public.current_user_workspace_id()));

-- ── 4. Ventana de inactividad ────────────────────────────────────────────────
-- `config_extra.bandeja_solicitudes.ventana_minutos`, entre 1 y 120; cualquier otra cosa → 5.
-- Mismos topes que `leerConfigBandeja` en `_shared/wa-bandeja-reglas.ts`. Un valor mal escrito
-- no puede tumbar el cierre de todos los workspaces: por eso no hay cast directo.

create or replace function public.wa_bandeja_ventana_minutos(p_config_extra jsonb)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when (p_config_extra -> 'bandeja_solicitudes' ->> 'ventana_minutos') ~ '^\d{1,3}$'
     and (p_config_extra -> 'bandeja_solicitudes' ->> 'ventana_minutos')::integer between 1 and 120
      then (p_config_extra -> 'bandeja_solicitudes' ->> 'ventana_minutos')::integer
    else 5
  end
$$;

revoke execute on function public.wa_bandeja_ventana_minutos(jsonb) from public, anon, authenticated;
grant execute on function public.wa_bandeja_ventana_minutos(jsonb) to service_role;

-- ── 5. Registrar y agrupar ───────────────────────────────────────────────────
-- Devuelve qué pasó (`accion`), la entrega y cuántos mensajes de contenido lleva:
--   duplicado          → ese wamid ya estaba: no se escribe nada
--   abrir / agregar    → nace una entrega / entra a la abierta
--   cerrar             → palabra de cierre con entrega abierta: se cierra
--   cierre_sin_abierta → palabra de cierre sin nada que cerrar (se guarda suelta)
--   respuesta_cliente  → sin entrega abierta, el primer escrito tras la pregunta es la respuesta
--
-- Serializada por remitente con un candado de transacción: dos webhooks del mismo comercial
-- no pueden decidir a la vez si hay entrega abierta. Remitentes distintos no se esperan.

create or replace function public.wa_bandeja_registrar_mensaje(
  p_workspace_id uuid,
  p_remitente_phone text,
  p_remitente_staff_id uuid,
  p_remitente_colaborador_id uuid,
  p_wa_message_id text,
  p_tipo text,
  p_cuerpo text,
  p_cuerpo_origen text,
  p_reenviado boolean,
  p_reenviado_muchas_veces boolean,
  p_meta_media_id text,
  p_transcripcion_error text,
  p_enviado_at timestamptz,
  p_es_cierre boolean,
  p_horas_respuesta_cliente integer default 24
)
returns table (accion text, entrega uuid, mensajes integer)
language plpgsql
volatile
set search_path = public
as $$
declare
  v_abierta_id uuid;
  v_abierta_n integer;
  v_espera_id uuid;
  v_id uuid;
  v_n integer;
  v_horas integer := least(greatest(coalesce(p_horas_respuesta_cliente, 24), 1), 168);
  v_reenviado boolean := coalesce(p_reenviado, false);
begin
  if p_workspace_id is null or coalesce(p_remitente_phone, '') = '' or coalesce(p_wa_message_id, '') = '' then
    raise exception 'wa_bandeja_registrar_mensaje: workspace, remitente y wa_message_id son obligatorios';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('wa_bandeja:' || p_workspace_id::text || ':' || p_remitente_phone, 0)
  );

  -- Meta reintenta: el mismo wamid no entra dos veces ni suma dos veces.
  select m.entrega_id into v_id
    from public.wa_bandeja_mensajes m
   where m.wa_message_id = p_wa_message_id;
  if found then
    return query select 'duplicado'::text, v_id, null::integer;
    return;
  end if;

  select e.id, e.n_mensajes into v_abierta_id, v_abierta_n
    from public.wa_bandeja_entregas e
   where e.workspace_id = p_workspace_id
     and e.remitente_phone = p_remitente_phone
     and e.estado = 'abierta'
   for update;

  -- Palabra de cierre: se guarda (con su papel) y cierra lo abierto, si hay.
  if coalesce(p_es_cierre, false) and not v_reenviado then
    insert into public.wa_bandeja_mensajes (
      workspace_id, entrega_id, wa_message_id, remitente_phone, remitente_staff_id,
      remitente_colaborador_id, tipo, papel, cuerpo, cuerpo_origen, reenviado,
      reenviado_muchas_veces, meta_media_id, transcripcion_error, enviado_at
    ) values (
      p_workspace_id, v_abierta_id, p_wa_message_id, p_remitente_phone, p_remitente_staff_id,
      p_remitente_colaborador_id, p_tipo, 'cierre', p_cuerpo, p_cuerpo_origen, false,
      coalesce(p_reenviado_muchas_veces, false), p_meta_media_id, p_transcripcion_error, p_enviado_at
    );

    if v_abierta_id is null then
      return query select 'cierre_sin_abierta'::text, null::uuid, 0;
      return;
    end if;

    update public.wa_bandeja_entregas
       set estado = 'esperando_cliente', cerrada_at = now(), motivo_cierre = 'palabra_cierre'
     where id = v_abierta_id;
    return query select 'cerrar'::text, v_abierta_id, v_abierta_n;
    return;
  end if;

  -- Hay entrega abierta: el mensaje se suma a ella.
  if v_abierta_id is not null then
    insert into public.wa_bandeja_mensajes (
      workspace_id, entrega_id, wa_message_id, remitente_phone, remitente_staff_id,
      remitente_colaborador_id, tipo, papel, cuerpo, cuerpo_origen, reenviado,
      reenviado_muchas_veces, meta_media_id, transcripcion_error, enviado_at
    ) values (
      p_workspace_id, v_abierta_id, p_wa_message_id, p_remitente_phone, p_remitente_staff_id,
      p_remitente_colaborador_id, p_tipo, 'contenido', p_cuerpo, p_cuerpo_origen, v_reenviado,
      coalesce(p_reenviado_muchas_veces, false), p_meta_media_id, p_transcripcion_error, p_enviado_at
    );
    update public.wa_bandeja_entregas
       set n_mensajes = n_mensajes + 1, ultimo_mensaje_at = now()
     where id = v_abierta_id
    returning n_mensajes into v_n;
    return query select 'agregar'::text, v_abierta_id, v_n;
    return;
  end if;

  -- Sin entrega abierta: ¿es la respuesta a «¿De qué cliente es?»? Solo un escrito o un audio
  -- NO reenviado, con texto, y dentro de la ventana desde que se hizo la pregunta.
  if not v_reenviado and p_tipo in ('text', 'audio') and coalesce(btrim(p_cuerpo), '') <> '' then
    select e.id into v_espera_id
      from public.wa_bandeja_entregas e
     where e.workspace_id = p_workspace_id
       and e.remitente_phone = p_remitente_phone
       and e.estado = 'esperando_cliente'
       and e.pregunta_enviada_at is not null
       and e.pregunta_enviada_at > now() - make_interval(hours => v_horas)
     order by e.cerrada_at desc
     limit 1
     for update;

    if v_espera_id is not null then
      insert into public.wa_bandeja_mensajes (
        workspace_id, entrega_id, wa_message_id, remitente_phone, remitente_staff_id,
        remitente_colaborador_id, tipo, papel, cuerpo, cuerpo_origen, reenviado,
        reenviado_muchas_veces, meta_media_id, transcripcion_error, enviado_at
      ) values (
        p_workspace_id, v_espera_id, p_wa_message_id, p_remitente_phone, p_remitente_staff_id,
        p_remitente_colaborador_id, p_tipo, 'respuesta_cliente', p_cuerpo, p_cuerpo_origen, false,
        coalesce(p_reenviado_muchas_veces, false), p_meta_media_id, p_transcripcion_error, p_enviado_at
      );
      update public.wa_bandeja_entregas
         set estado = 'con_cliente', cliente_texto = p_cuerpo, cliente_respondido_at = now()
       where id = v_espera_id
      returning n_mensajes into v_n;
      return query select 'respuesta_cliente'::text, v_espera_id, v_n;
      return;
    end if;
  end if;

  -- Primer mensaje: nace la entrega.
  insert into public.wa_bandeja_entregas (
    workspace_id, remitente_phone, remitente_staff_id, remitente_colaborador_id, n_mensajes
  ) values (
    p_workspace_id, p_remitente_phone, p_remitente_staff_id, p_remitente_colaborador_id, 1
  )
  returning id into v_id;

  insert into public.wa_bandeja_mensajes (
    workspace_id, entrega_id, wa_message_id, remitente_phone, remitente_staff_id,
    remitente_colaborador_id, tipo, papel, cuerpo, cuerpo_origen, reenviado,
    reenviado_muchas_veces, meta_media_id, transcripcion_error, enviado_at
  ) values (
    p_workspace_id, v_id, p_wa_message_id, p_remitente_phone, p_remitente_staff_id,
    p_remitente_colaborador_id, p_tipo, 'contenido', p_cuerpo, p_cuerpo_origen, v_reenviado,
    coalesce(p_reenviado_muchas_veces, false), p_meta_media_id, p_transcripcion_error, p_enviado_at
  );

  return query select 'abrir'::text, v_id, 1;
end;
$$;

revoke execute on function public.wa_bandeja_registrar_mensaje(
  uuid, text, uuid, uuid, text, text, text, text, boolean, boolean, text, text, timestamptz, boolean, integer
) from public, anon, authenticated;
grant execute on function public.wa_bandeja_registrar_mensaje(
  uuid, text, uuid, uuid, text, text, text, text, boolean, boolean, text, text, timestamptz, boolean, integer
) to service_role;

-- ── 6. Cerrar por inactividad ────────────────────────────────────────────────
-- Una sola sentencia: lo que devuelve es exactamente lo que cerró, así que el bot pregunta una
-- vez por entrega aunque el cron se cruce consigo mismo. `skip locked`: una entrega que en ese
-- instante está recibiendo un mensaje no se cierra; la toma el minuto siguiente si sigue quieta.

create or replace function public.wa_bandeja_cerrar_vencidas()
returns table (entrega uuid, workspace uuid, telefono text, mensajes integer)
language sql
volatile
set search_path = public
as $$
  with vencidas as (
    select e.id
      from public.wa_bandeja_entregas e
      join public.workspaces w on w.id = e.workspace_id
     where e.estado = 'abierta'
       and e.ultimo_mensaje_at < now() - make_interval(mins => public.wa_bandeja_ventana_minutos(w.config_extra))
     for update of e skip locked
  )
  update public.wa_bandeja_entregas e
     set estado = 'esperando_cliente', cerrada_at = now(), motivo_cierre = 'inactividad'
    from vencidas v
   where e.id = v.id
  returning e.id, e.workspace_id, e.remitente_phone, e.n_mensajes
$$;

revoke execute on function public.wa_bandeja_cerrar_vencidas() from public, anon, authenticated;
grant execute on function public.wa_bandeja_cerrar_vencidas() to service_role;
