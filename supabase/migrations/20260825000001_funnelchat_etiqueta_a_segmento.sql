-- La etiqueta que se pone en FunnelChat mueve el status del contacto en ONE.
--
-- Hasta hoy `/api/webhooks/funnelchat` era solo bitacora: dejaba constancia de que
-- el envio llegaba y no escribia nada. Esa prueba ya esta ganada (hay eventos
-- `tag_agregado` autenticados desde el 2026-08-24), asi que la bitacora pasa a ser
-- integracion. Esta migracion pone las tres piezas de base que le faltan.
--
-- ⚠️ Alcance: SOLO `contactos.segmento`. Los negocios no se tocan. Una etiqueta de
-- WhatsApp dice algo de la conversacion con la persona, no del tramite.

-- 1) Buscar el contacto por su movil ─────────────────────────────────────────
--
-- Ya existia en la base pero sin migracion que la respaldara (se creo a mano
-- durante la prueba). Se formaliza aqui para que el repositorio y produccion digan
-- lo mismo; `create or replace` la deja igual si ya estaba.
--
-- Compara NORMALIZADO por los dos lados y no en crudo: FunnelChat manda
-- `573155542420` y de los 856 contactos de SOENA solo 48 estan guardados como
-- `3155542420`; el resto son `+573158135030` o hasta `+57(322)604-3955`. Cruzar
-- los textos tal cual no encontraria practicamente a nadie, y el sintoma seria el
-- peor de todos: el webhook responde 200 y no pasa nada.
--
-- Devuelve TODAS las coincidencias, no una: dos contactos con el mismo telefono es
-- una ambiguedad real que quien llama tiene que resolver, y elegir uno en silencio
-- le escribiria el status al que no es.
create or replace function public.funnelchat_contactos_por_telefono(
  p_workspace_id uuid,
  p_nacional text
)
returns table(id uuid, nombre text, telefono text, segmento text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.id, c.nombre, c.telefono, c.segmento
  from public.contactos c
  where c.workspace_id = p_workspace_id
    and p_nacional ~ '^3[0-9]{9}$'
    and public.telefono_movil_co(c.telefono) = p_nacional
  order by c.created_at
$$;

-- server-only: la invoca /api/webhooks/funnelchat con service_role. El navegador no
-- tiene por que resolver un telefono a un contacto, y `revoke ... from anon` a secas
-- no basta: la funcion sigue alcanzable como miembro de PUBLIC (gotcha #185).
revoke execute on function public.funnelchat_contactos_por_telefono(uuid, text) from public, anon, authenticated;

comment on function public.funnelchat_contactos_por_telefono(uuid, text) is
  'Contactos del workspace cuyo movil normalizado es p_nacional (10 digitos). Devuelve todas las coincidencias: la ambiguedad la resuelve quien llama.';

-- 2) Que hizo ONE con cada evento ────────────────────────────────────────────
--
-- `motivo` ya contaba si el token servia. Esta columna cuenta lo otro: si el evento
-- movio un status, a quien, y si no lo movio, por que no. Sin esto la unica forma
-- de saber por que una etiqueta no se reflejo seria leer logs de Vercel, y una
-- integracion que no puede explicarse a si misma se abandona.
alter table public.funnelchat_eventos
  add column if not exists resultado jsonb;

comment on column public.funnelchat_eventos.resultado is
  'Que hizo ONE con el evento: {accion, contacto_id, de, a} al aplicar, o {accion:"ignorado", motivo} cuando no aplica.';

-- 3) El mapa etiqueta -> status ──────────────────────────────────────────────
--
-- Vive en configuracion y no en el codigo porque los nombres de las etiquetas son
-- de cada cliente. El dia que SOENA renombre "Seguimiento" no puede depender de un
-- despliegue para recuperar su tablero.
--
-- El mapa es PARCIAL a proposito. De las 9 etiquetas vivas de SOENA quedan fuera
-- "Calificado" (ES HEV/PHEV/EV) y "Pendiente Bizagi": describen el caso, no la
-- gestion del contacto, y no tienen equivalente en el catalogo de status. Se
-- registran como `etiqueta_sin_mapa` en vez de forzarles un status, porque meter
-- informacion del tramite dentro del status de gestion lo vuelve inservible para
-- lo unico que sirve, que es saber a quien falta llamar.
--
-- "Propuesta" y "Cerrado" si entran como `conectado`: no hay status mas fino en el
-- catalogo, pero de ambas se deduce con certeza que la conversacion ocurrio.
--
-- Solo se siembra donde FunnelChat ya esta configurado y todavia no hay mapa, para
-- no pisar un mapa que alguien haya ajustado a mano.
update public.workspaces
set config_extra = jsonb_set(
  config_extra,
  '{funnelchat,mapa_segmentos}',
  jsonb_build_object(
    'Lead',          'sin_contactar',
    'Seguimiento',   'primer_contacto',
    'No contesta',   'no_contesto',
    'Conectado',     'conectado',
    'Propuesta',     'conectado',
    'Cerrado',       'conectado',
    'No calificado', 'descartado'
  ),
  true
)
where config_extra ? 'funnelchat'
  and not (config_extra -> 'funnelchat' ? 'mapa_segmentos');
