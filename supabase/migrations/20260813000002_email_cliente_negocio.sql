-- Correo del CLIENTE de un negocio, con una sola definición para todo el sistema.
--
-- Hace falta para el aviso de avance al cliente: hay que saber a quién escribirle.
-- Vive en SQL y no en TypeScript porque los dos consumidores están en runtimes
-- distintos (la edge function corre en Deno y no puede importar de `src/`), y dos
-- copias de esta regla se desincronizarían sin que nadie lo note: el síntoma sería
-- "a unos clientes les llega y a otros no".
--
-- Precedencia, medida contra producción el 2026-08-13 en SOENA:
--   1. `contactos.email` — el dato que el equipo captura y mantiene.
--   2. el `email` extraído del RUT — 192 negocios lo tienen; 25 de los 89 casos
--      parados en Cita SOLO se pueden contactar por esta vía.
-- Con las dos, la cobertura en Cita es del 100%; con `contactos.email` sola, 73%.
--
-- Devuelve NULL si no hay correo utilizable. Quien llame decide qué hacer con eso;
-- lo que no puede es inventarse un destinatario.

create or replace function public.email_cliente_negocio(p_negocio_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with del_contacto as (
    select nullif(trim(c.email), '') as email
    from negocios n
    join contactos c on c.id = n.contacto_id
    where n.id = p_negocio_id
  ),
  del_rut as (
    -- Un negocio puede traer varias filas del bloque (las copias readonly heredadas
    -- viajan con él entre etapas): se toma el primero no vacío, sin depender del orden
    -- en que lleguen.
    select nullif(trim(nb.data -> 'campos' -> 'email' ->> 'value'), '') as email
    from negocio_bloques nb
    join bloque_configs bc on bc.id = nb.bloque_config_id
    where nb.negocio_id = p_negocio_id
      and bc.slug in ('rut', 'rut_solicitante_2')
      and nullif(trim(nb.data -> 'campos' -> 'email' ->> 'value'), '') is not null
    limit 1
  )
  select lower(coalesce(
    (select email from del_contacto),
    (select email from del_rut)
  ))
  -- Un texto que no parece correo no se manda: mejor sin destinatario que a una
  -- dirección inventada.
  where coalesce((select email from del_contacto), (select email from del_rut)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$function$;

revoke execute on function public.email_cliente_negocio(uuid) from public, anon, authenticated;

comment on function public.email_cliente_negocio(uuid) is
  'Correo del cliente de un negocio: contactos.email y, si falta, el email extraido del RUT. NULL si no hay uno valido. Fuente unica para el aviso de avance al cliente.';
