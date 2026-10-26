-- La conversación completa del bot de WhatsApp con el equipo: lo que escriben, lo que reenvían, lo que tocan y lo que
-- el bot les contesta, con su texto entero.
--
-- Diseño: proyectos/trappvel/clarity/docs/diseno/2026-10-06_investigacion-agentes-conversacionales.md (§2.4, §3.2) y
-- brief-max-2026-10-06-nucleo-conversacional.md, punto 1.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Por qué
-- ─────────────────────────────────────────────────────────────────────────────
--
-- La conversación no se guardaba completa: `wa_envios.preview` corta en 300 caracteres, `wa_message_log` en 100, los
-- toques se guardan como un id opaco y las respuestas del bot no se pueden reconstruir. El texto exacto que el bot mandó
-- a las 13:45:39 del 2026-10-06 no existe en ninguna parte. Sin la conversación completa ningún modelo puede tener el
-- contexto de lo que se habló, y ningún arnés puede reactuar una conversación real.
--
-- Una fila por mensaje, en las dos direcciones:
--   · entrante: `clase` = escrito | reenvio | toque | audio | imagen | ubicacion | otro.
--   · saliente: `clase` = bot, con `formato` (texto, botones, lista, plantilla, documento, otro) y sus `opciones`.
-- `turno_id` y `traza` los llena el núcleo conversacional (PR siguiente) para dejar por qué hizo lo que hizo.
--
-- Quién se guarda: SOLO el equipo de los workspaces con la bandeja de solicitudes o el bot conversacional configurado,
-- y solo después de la puerta del aviso de datos (lo retenido sin aceptar no se escribe). Los salientes se guardan solo
-- para un teléfono que escribió en las últimas 24 h y quedó aquí (la RPC lo decide en la misma sentencia): nadie fuera
-- de esa conversación entra por el lado de lo que sale.
--
-- Retención: sin borrado automático en esta migración. El núcleo lee 24 h; cuánto se conserva lo decide Emilio.
--
-- epoca: no-rompe tabla y función nuevas; no toca nada que use el código de hoy.

create table public.wa_conversacion (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Solo dígitos, igual en las dos direcciones (el webhook y los envíos no siempre traen el mismo formato).
  phone text not null,
  direccion text not null,
  clase text not null,
  -- Solo salientes: cómo salió.
  formato text,
  -- El texto COMPLETO: el escrito, el reenvío, la transcripción de un audio, el título del botón tocado o el cuerpo de lo
  -- que el bot mandó. Si el envío llevaba un secreto, aquí va su `preview` y no el texto real (ver `wa-envios.ts`).
  texto text,
  -- Solo salientes interactivos: [{ "id", "titulo", "descripcion"? }] en el orden en que se mostraron.
  opciones jsonb,
  -- Solo toques: el id de la opción tocada y el wamid del mensaje que tenía el botón (`context.id` de Meta).
  toque_id text,
  contexto_wamid text,
  -- Solo audios e imágenes: { "tipo", "id" } del medio en Meta (no se descarga aquí).
  media jsonb,
  wa_message_id text,
  -- Solo salientes: quién lo mandó (`wa_envios.origen`) y para qué (`intent`).
  origen text,
  intent text,
  -- El turno del núcleo conversacional al que pertenece la fila y su traza (herramientas, reglas, candados, tiempos).
  turno_id uuid,
  traza jsonb,
  created_at timestamptz not null default now(),
  constraint wa_conversacion_direccion check (direccion in ('entrante', 'saliente')),
  constraint wa_conversacion_clase check (
    (direccion = 'entrante' and clase in ('escrito', 'reenvio', 'toque', 'audio', 'imagen', 'ubicacion', 'otro'))
    or (direccion = 'saliente' and clase = 'bot')
  ),
  constraint wa_conversacion_formato check (
    formato is null or formato in ('texto', 'botones', 'lista', 'plantilla', 'documento', 'otro')
  ),
  constraint wa_conversacion_texto_largo check (texto is null or char_length(texto) <= 20000)
);

comment on table public.wa_conversacion is
  'Conversacion completa del bot de WhatsApp con el equipo (escritos, reenvios, toques y respuestas del bot, con su texto entero) y la traza de cada turno del nucleo conversacional. La escribe y la lee solo el bot (service_role).';

-- Meta reintenta el mismo mensaje hasta por 7 días: un wamid se guarda una vez.
create unique index wa_conversacion_wamid on public.wa_conversacion (wa_message_id) where wa_message_id is not null;
-- La lectura del núcleo: la conversación de un remitente en las últimas 24 h, en orden.
create index wa_conversacion_remitente on public.wa_conversacion (phone, created_at desc);
create index wa_conversacion_workspace on public.wa_conversacion (workspace_id, created_at desc);
create index wa_conversacion_turno on public.wa_conversacion (turno_id) where turno_id is not null;

alter table public.wa_conversacion enable row level security;

-- server-only: la escribe y la lee solo el bot (edge functions con service_role); la app no la usa y nadie con sesión
-- la puede leer. Sin policies a propósito.
revoke all on public.wa_conversacion from anon, authenticated;
grant all on public.wa_conversacion to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Lo que sale: se guarda solo si el teléfono tiene conversación abierta (un entrante en las últimas 24 h)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Todo envío pasa por `postMessage` (`wa-respond.ts`), en cualquier función (wa-webhook, wa-alerts). Decidir aquí, en una
-- sola sentencia, evita una consulta previa por envío y una caché por teléfono: si la persona no escribió, la fila no
-- nace. El workspace es el del último entrante (una persona puede estar en dos). Devuelve si guardó.
create or replace function public.wa_conversacion_registrar_saliente(
  p_phone text,
  p_wa_message_id text,
  p_texto text,
  p_formato text,
  p_opciones jsonb,
  p_origen text,
  p_intent text
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_ws uuid;
begin
  if v_phone = '' then
    return false;
  end if;

  select c.workspace_id into v_ws
  from public.wa_conversacion c
  where c.phone = v_phone
    and c.direccion = 'entrante'
    and c.created_at > now() - interval '24 hours'
  order by c.created_at desc
  limit 1;

  if v_ws is null then
    return false;
  end if;

  insert into public.wa_conversacion (workspace_id, phone, direccion, clase, formato, texto, opciones, wa_message_id, origen, intent)
  values (v_ws, v_phone, 'saliente', 'bot', p_formato, left(p_texto, 20000), p_opciones, p_wa_message_id, p_origen, p_intent)
  on conflict (wa_message_id) where wa_message_id is not null do nothing;

  return true;
end;
$$;

comment on function public.wa_conversacion_registrar_saliente(text, text, text, text, jsonb, text, text) is
  'Guarda un mensaje que el bot envio, solo si ese telefono tiene un entrante en wa_conversacion en las ultimas 24 h. La llama solo wa-respond (service_role).';

revoke execute on function public.wa_conversacion_registrar_saliente(text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.wa_conversacion_registrar_saliente(text, text, text, text, jsonb, text, text) to service_role;
