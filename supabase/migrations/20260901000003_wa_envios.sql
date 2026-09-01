-- ============================================================
-- wa_envios — bitacora de entrega de TODO lo que MeTRIK manda por WhatsApp
-- ------------------------------------------------------------
-- Detonante: el contrato de TERMOTECH SAS (2026-08-31). Salio por la Graph API y no
-- quedo rastro de si le llego al cliente. Hoy la pregunta "esto se entrego?" no tiene
-- donde contestarse: el webhook recibe los acuses de Meta y los bota (`statuses` cae en
-- el `return 200` de wa-webhook), y los envios de plantilla ni siquiera pasan por codigo.
--
-- Por que tabla nueva y no columnas en `wa_message_log`:
--   `wa_message_log.direction = 'outbound'` NO es una bitacora, es un contador.
--   `checkOutboundAlertLimit` cuenta esas filas contra un tope de 2 por dia
--   (`_shared/wa-rate-limit.ts`), y su unico escritor es `wa-alerts`. El dia que el bot
--   registre ahi sus propias respuestas, cualquiera que chatee dos veces deja de recibir
--   alertas, sin error y sin sintoma. Esa tabla se deja como esta.
--
-- Una fila por MENSAJE, no por evento. Meta manda 'sent', 'delivered' y 'read' del mismo
-- mensaje: los tres mutan la misma fila. Un evento por fila triplicaria la tabla sin
-- responder mejor lo unico que importa.
-- ============================================================

-- server-only: bitacora de infraestructura de WhatsApp. La escriben las Edge Functions con
-- service_role y no la consulta ningun usuario final. Cuando exista pantalla de auditoria se
-- abre con su propio grant y su politica por workspace, que es una decision aparte de esta.
create table if not exists public.wa_envios (
  id uuid primary key default gen_random_uuid(),

  -- wamid que devuelve la Graph API. Es la llave de cruce con los `statuses` del webhook,
  -- y la razon por la que este frente empieza en `postMessage`: hoy esa respuesta se bota.
  -- Nulo solo si el POST fallo antes de devolver id (ahi el status nace en 'rechazado').
  wa_message_id text unique,

  workspace_id uuid references public.workspaces(id),
  phone text not null,

  -- Quien lo mando. 'desconocido' es real y se guarda: es un acuse de un mensaje que
  -- ningun codigo registro (envio manual, o anterior a esta tabla). Verlo vale mas que
  -- descartarlo, porque marca justo el hueco que este frente vino a cerrar.
  origen text not null default 'bot'
    check (origen in ('bot', 'alerta', 'template', 'interno', 'desconocido')),
  template_name text,
  intent text,
  preview text,

  -- 'aceptado' = la Graph API lo recibio; de ahi en adelante el estado lo dicta Meta.
  -- 'rechazado' = la Graph API lo rechazo, nunca existio como mensaje.
  status text not null default 'aceptado'
    check (status in ('aceptado', 'sent', 'delivered', 'read', 'failed', 'rechazado')),
  status_at timestamptz,
  error_code int,
  error_title text,

  created_at timestamptz not null default now()
);

alter table public.wa_envios enable row level security;

create index if not exists idx_wa_envios_phone_time on public.wa_envios (phone, created_at desc);
create index if not exists idx_wa_envios_ws_time on public.wa_envios (workspace_id, created_at desc);
-- Lo que se consulta de urgencia es "que no llego". Son pocas filas: indice parcial.
create index if not exists idx_wa_envios_fallidos on public.wa_envios (created_at desc)
  where status in ('failed', 'rechazado');

-- ── Orden de los acuses ────────────────────────────────────────────────────────────────
-- Meta no garantiza el orden de entrega de los `statuses`: un 'sent' rezagado puede llegar
-- despues del 'read' del mismo mensaje. Sin este orden, el ultimo en llegar gana y la fila
-- retrocede. 'failed' esta arriba de todo a proposito: si un mensaje fallo, eso es lo que
-- hay que ver, aunque antes se hubiera reportado entregado.
create or replace function public.wa_rango_status(p_status text)
returns int
language sql
immutable
as $$
  select case p_status
    when 'aceptado'  then 0
    when 'sent'      then 1
    when 'delivered' then 2
    when 'read'      then 3
    when 'rechazado' then 98
    when 'failed'    then 99
    else -1
  end;
$$;

-- Aplica un acuse sobre el envio. Es funcion y no un upsert desde el cliente porque la
-- decision de avanzar necesita comparar contra la fila que ya esta: desde afuera son dos
-- viajes y una carrera entre acuses simultaneos del mismo mensaje.
create or replace function public.wa_aplicar_status(
  p_wa_message_id text,
  p_status        text,
  p_status_at     timestamptz default now(),
  p_phone         text default null,
  p_error_code    int default null,
  p_error_title   text default null
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_wa_message_id is null or p_status is null then
    return;
  end if;

  insert into public.wa_envios (wa_message_id, phone, origen, status, status_at, error_code, error_title)
  values (
    p_wa_message_id,
    coalesce(nullif(p_phone, ''), 'sin_registro'),
    'desconocido',
    p_status,
    p_status_at,
    p_error_code,
    p_error_title
  )
  on conflict (wa_message_id) do update
    set status = case
          when wa_rango_status(excluded.status) > wa_rango_status(public.wa_envios.status)
          then excluded.status else public.wa_envios.status end,
        status_at = case
          when wa_rango_status(excluded.status) > wa_rango_status(public.wa_envios.status)
          then excluded.status_at else public.wa_envios.status_at end,
        -- El detalle del error nunca se pierde: si una vez fallo, se conserva.
        error_code  = coalesce(excluded.error_code, public.wa_envios.error_code),
        error_title = coalesce(excluded.error_title, public.wa_envios.error_title);
end;
$$;

-- Solo la escribe la infraestructura. `service_role` no pasa por estos grants; el revoke
-- es para que no quede colgando por RPC como paso con las nueve de 20260901000001.
revoke execute on function public.wa_rango_status(text) from public, anon, authenticated;
revoke execute on function public.wa_aplicar_status(text, text, timestamptz, text, int, text)
  from public, anon, authenticated;
