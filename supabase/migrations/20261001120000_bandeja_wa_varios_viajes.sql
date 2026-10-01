-- ============================================================
-- 20261001120000 — Bandeja de WhatsApp: varios viajes en una entrega y guardianes
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-01-varios-viajes-y-guardianes.md
-- Base: 20260925200000, 20260929100000 y 20260930100000 (todas aplicadas).
--
-- Qué cambia:
--   1. La asignación es POR MENSAJE y queda guardada (para auditar de dónde salió cada dato):
--      · `wa_bandeja_mensajes.segmento`: el número del viaje (1, 2…) dentro de la entrega al que
--        se cargó el mensaje; nulo = no se cargó (sin asignar, descartado, encabezado);
--      · `wa_bandeja_mensajes.asignacion`: {destino, por, evidencia, motivo, varios, descartado,
--        confirmado_at}. `por` = encabezado | modelo | bloque | comercial;
--      · `wa_bandeja_mensajes.clase`: quién habla (N3): cliente | comercial | tercero | ruido |
--        encabezado. Solo lo del cliente llena campos.
--   2. `wa_bandeja_entregas.plan_viajes`: el reparto propuesto (modo encabezado/mixto) que el
--      comercial confirma o corrige. Nada se carga hasta el «sí». `plan_confirmado_at`: cuándo.
--   3. `wa_bandeja_entendimientos`:
--      · `segmento` (0 = la entrega entera; 1, 2… = un viaje del reparto). El reclamo pasa a ser
--        único por (entrega, segmento): cada viaje se entiende y se carga por separado;
--      · estado nuevo `repartida`: la fila 0 de una entrega cuyo reparto se confirmó;
--      · `confirmacion_pendiente`: qué espera el bot del comercial además de «¿A qué viaje van?»
--        — `cruce` (N6, los mensajes hablan de otro viaje), `sin_solicitud` (N4) o `dos_viajes`
--        (N5). La respuesta llega por la misma vía (`respuesta_negocio`).
--
--   4. `wa_bandeja_registrar_mensaje` gana `p_puede_ser_respuesta` (default true): un encabezado
--      no se toma como la respuesta a una pregunta pendiente.
--
-- Sin datos que migrar: la bandeja sigue apagada (`modules.bandeja_solicitudes_wa`), las columnas
-- nuevas nacen nulas y `segmento` nace en 0 (lo que tiene hoy cada fila). Sin tablas nuevas: los
-- permisos y el RLS de las tres tablas no cambian. La función se recrea con su revoke y su grant.
-- El cron no cambia: los estados que esperan respuesta siguen siendo `esperando_negocio` y
-- `esperando_contacto`.
--
-- ORDEN: esta migración ANTES del deploy de `wa-alerts` y `wa-webhook` (el código escribe las
-- columnas nuevas y el upsert usa la unicidad nueva). Ojo: el upsert del código viejo,
-- `on conflict (entrega_id)`, se queda sin índice que lo respalde, así que el deploy va
-- inmediatamente después. Con la bandeja apagada el código viejo nunca llega a ese upsert.
--
-- Verificación después de aplicar (solo lectura):
--   select column_name from information_schema.columns
--    where table_name = 'wa_bandeja_mensajes' and column_name in ('segmento', 'asignacion', 'clase');   -> 3 filas
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'wa_bandeja_entendimientos_entrega_segmento';
--     -> UNIQUE (entrega_id, segmento)
-- ============================================================

-- ── 1. Asignación por mensaje ────────────────────────────────────────────────
alter table public.wa_bandeja_mensajes
  add column segmento integer
    constraint wa_bandeja_mensajes_segmento check (segmento is null or segmento >= 1),
  add column asignacion jsonb,
  add column clase text
    constraint wa_bandeja_mensajes_clase check (clase in ('cliente', 'comercial', 'tercero', 'ruido', 'encabezado'));

comment on column public.wa_bandeja_mensajes.segmento is
  'Viaje (1, 2…) de la entrega al que se cargó el mensaje. Nulo = no se cargó en ninguno.';
comment on column public.wa_bandeja_mensajes.asignacion is
  'A qué viaje va y por qué: {destino, por: encabezado|modelo|bloque|comercial, evidencia, motivo, varios, descartado, confirmado_at}.';
comment on column public.wa_bandeja_mensajes.clase is
  'Quién habla (N3): cliente | comercial | tercero | ruido | encabezado. Solo lo del cliente llena campos.';

create index wa_bandeja_mensajes_segmento
  on public.wa_bandeja_mensajes (entrega_id, segmento)
  where segmento is not null;

-- ── 2. El reparto propuesto ──────────────────────────────────────────────────
alter table public.wa_bandeja_entregas
  add column plan_viajes jsonb,
  add column plan_confirmado_at timestamptz;

comment on column public.wa_bandeja_entregas.plan_viajes is
  'Reparto por mensaje (modo encabezado/mixto): {version, mensajes:[{n, destino, por, evidencia, motivo, varios, descartado}], encabezados, avisos}. Nulo = modo uno.';

-- ── 3. Un entendimiento por viaje del reparto ────────────────────────────────
alter table public.wa_bandeja_entendimientos
  add column segmento integer not null default 0
    constraint wa_bandeja_entendimientos_segmento_valido check (segmento >= 0),
  add column confirmacion_pendiente text
    constraint wa_bandeja_entendimientos_confirmacion check (confirmacion_pendiente in ('cruce', 'sin_solicitud', 'dos_viajes'));

alter table public.wa_bandeja_entendimientos drop constraint wa_bandeja_entendimientos_entrega;
alter table public.wa_bandeja_entendimientos
  add constraint wa_bandeja_entendimientos_entrega_segmento unique (entrega_id, segmento);

alter table public.wa_bandeja_entendimientos drop constraint wa_bandeja_entendimientos_estado;
alter table public.wa_bandeja_entendimientos add constraint wa_bandeja_entendimientos_estado
  check (estado in (
    'procesando', 'error', 'esperando_negocio', 'esperando_contacto',
    'negocio_creado', 'negocio_actualizado', 'descartada', 'repartida'
  ));

-- ── 4. Un encabezado no es la respuesta a una pregunta ───────────────────────
-- QA de #971: con un resumen pendiente, el primer escrito propio se tomaba como la respuesta
-- (`respuesta_cliente`) aunque fuera un encabezado («Carolina») que abre otra tanda. El código
-- (`wa-bandeja.ts`) sabe si el escrito es un encabezado y lo dice con `p_puede_ser_respuesta =
-- false`: el mensaje entra como contenido de una entrega nueva. Todo lo demás, igual que en
-- 20260925200000. La firma cambia (un parámetro más, con default), así que se borra la vieja.

drop function public.wa_bandeja_registrar_mensaje(uuid, text, uuid, uuid, text, text, text, text, boolean, boolean, text, text, timestamptz, boolean, integer);

create function public.wa_bandeja_registrar_mensaje(
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
  p_horas_respuesta_cliente integer default 24,
  p_puede_ser_respuesta boolean default true
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
  if not v_reenviado and coalesce(p_puede_ser_respuesta, true)
     and p_tipo in ('text', 'audio') and coalesce(btrim(p_cuerpo), '') <> '' then
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

revoke execute on function public.wa_bandeja_registrar_mensaje(uuid,text,uuid,uuid,text,text,text,text,boolean,boolean,text,text,timestamptz,boolean,integer,boolean) from public, anon, authenticated;
grant execute on function public.wa_bandeja_registrar_mensaje(uuid,text,uuid,uuid,text,text,text,text,boolean,boolean,text,text,timestamptz,boolean,integer,boolean) to service_role;
