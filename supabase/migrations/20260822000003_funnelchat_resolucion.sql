-- A quien pertenece una conversacion de FunnelChat.
--
-- La bitacora `funnelchat_eventos` ya guardaba QUE llego. Esto guarda a QUIEN se
-- resolvio, que es lo que hace falta para atar la conversacion al negocio (punto
-- 59 del inventario SOENA) y para que la evidencia de "no calificado" sea la
-- conversacion misma (punto 58).

-- ── 1. La regla del telefono movil colombiano, en un solo lugar ──────────────
--
-- Ya existia, inlineada dentro de `telefono_cliente_negocio` (20260814000001).
-- Su propio encabezado advierte que "dos copias de esta regla se
-- desincronizarian sin que nadie lo note", y este frente iba a ser la segunda
-- copia. Se extrae en vez de duplicarse.
--
-- ⚠️ El orden de los tres pasos NO es cosmetico (medido el 2026-08-14 sobre 254
-- negocios abiertos de SOENA: 15 formas de telefono conviviendo):
--   1. Cortar en el punto ANTES de quitar los no-digitos. Al reves,
--      `3001234567.0` (el cargue leyo la celda de Excel como NUMERO) se vuelve
--      `30012345670`: once digitos, un numero que no existe.
--   2. Quitar todo lo que no sea digito.
--   3. Colapsar los `57` iniciales repetidos (`+57 +57 300...`).
-- Devuelve el numero NACIONAL sin indicativo; quien quiera E.164 le antepone +57.
create or replace function public.telefono_movil_co(p_crudo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(split_part(coalesce(p_crudo, ''), '.', 1), '[^0-9]', '', 'g'),
      '^(57)+', ''),
    '')
$$;

revoke execute on function public.telefono_movil_co(text) from public, anon, authenticated;

comment on function public.telefono_movil_co(text) is
  'Digitos nacionales de un telefono colombiano escrito como sea (decimal de Excel, indicativo duplicado, separadores). NO valida que sea movil: quien llame exige ^3[0-9]{9}$ si lo necesita. Fuente unica de la regla; ver telefono_cliente_negocio.';

-- `telefono_cliente_negocio` pasa a llamarla en vez de repetirla. Equivalencia
-- verificada contra produccion antes de escribir esto: 378 negocios, **0
-- diferencias** entre lo que devolvia y lo que devuelve.
create or replace function public.telefono_cliente_negocio(p_negocio_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with crudo as (
    select
      (select nullif(trim(c.telefono), '')
         from contactos c
        where c.id = n.contacto_id) as del_contacto,
      -- Un negocio puede traer varias filas del bloque (las copias readonly heredadas
      -- viajan con el entre etapas): se toma el primero no vacio, sin depender del
      -- orden en que lleguen.
      (select nullif(trim(nb.data -> 'campos' -> 'telefono' ->> 'value'), '')
         from negocio_bloques nb
         join bloque_configs bc on bc.id = nb.bloque_config_id
        where nb.negocio_id = n.id
          and bc.slug in ('rut', 'rut_solicitante_2')
          and nullif(trim(nb.data -> 'campos' -> 'telefono' ->> 'value'), '') is not null
        limit 1) as del_rut
    from negocios n
    where n.id = p_negocio_id
  ),
  normalizado as (
    select public.telefono_movil_co(del_contacto) as contacto,
           public.telefono_movil_co(del_rut)      as rut
    from crudo
  )
  -- Un fijo no recibe WhatsApp y un handle de Instagram no es un numero: los dos
  -- se descartan devolviendo NULL. Quien llame decide que hacer con eso; lo que
  -- no puede es inventarse un destinatario.
  select '+57' || coalesce(
    (select contacto from normalizado where contacto ~ '^3[0-9]{9}$'),
    (select rut      from normalizado where rut      ~ '^3[0-9]{9}$')
  )
  from normalizado
  where contacto ~ '^3[0-9]{9}$' or rut ~ '^3[0-9]{9}$';
$function$;

-- ── 2. El veredicto de cada evento ───────────────────────────────────────────
--
-- ⚠️ El telefono NO identifica a un contacto por si solo. Medido en SOENA el
-- 2026-08-22: de 709 contactos con movil valido, **33 numeros estan repetidos y
-- abarcan 73 contactos**. Hay de tres clases y ninguna se resuelve sola:
--   1. duplicados del mismo nombre (FABIAN TORRES x4),
--   2. variantes del mismo nombre (JOSE VIDES / JOSÉ VIDES SANCHEZ),
--   3. personas distintas compartiendo linea (una persona y su empresa; dos
--      familiares), y un numero con CINCO nombres sin relacion entre si, que
--      huele a numero comodin tecleado por alguien.
-- Por eso `resolucion` distingue `unico` de `ambiguo` y en el segundo caso
-- guarda TODOS los candidatos sin elegir. `contacto_id` solo se llena cuando fue
-- unico: elegir el primero le colgaria a un contacto una conversacion que puede
-- no ser suya, y como nada fallaria, nadie se enteraria.
alter table public.funnelchat_eventos
  add column if not exists contacto_id uuid references public.contactos(id) on delete set null,
  add column if not exists resolucion jsonb;

comment on column public.funnelchat_eventos.contacto_id is
  'Contacto al que se resolvio el evento. Solo se llena cuando la resolucion fue UNICA; ambigua o vacia lo deja en null a proposito.';
comment on column public.funnelchat_eventos.resolucion is
  'Veredicto completo: {estado: unico|ambiguo|sin_contacto|sin_telefono, clave, nacional, candidatos[]}. Incluye la ambiguedad para que no haya que reconstruirla despues.';

create index if not exists idx_funnelchat_eventos_contacto
  on public.funnelchat_eventos (contacto_id, recibido_en desc)
  where contacto_id is not null;

-- Busqueda por numero nacional. Pasa en la base y no en el servidor para no
-- traerse los 740 contactos del workspace por cada mensaje que entre.
--
-- server-only: la invoca el receptor con service_role. NO se concede a
-- `authenticated` porque recibe el workspace por parametro y no pasa por RLS;
-- exponerla seria un hueco entre inquilinos.
create or replace function public.funnelchat_contactos_por_telefono(
  p_workspace_id uuid,
  p_nacional text
)
returns table (id uuid, nombre text, telefono text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.id, c.nombre, c.telefono
  from public.contactos c
  where c.workspace_id = p_workspace_id
    and p_nacional ~ '^3[0-9]{9}$'
    and public.telefono_movil_co(c.telefono) = p_nacional
  order by c.created_at
$$;

revoke execute on function public.funnelchat_contactos_por_telefono(uuid, text) from public, anon, authenticated;

comment on function public.funnelchat_contactos_por_telefono(uuid, text) is
  'Contactos del workspace cuyo movil normalizado es el numero dado. Puede devolver mas de uno: la ambiguedad es real y la decide quien llama, no esta funcion.';
