-- El correo del cliente es SIEMPRE el que quedo registrado en el RUT.
-- Antes ganaba el email del contacto (quien radica el caso, a veces un
-- intermediario) y el RUT solo entraba de respaldo: en 55 de los 372 negocios
-- abiertos de SOENA los dos correos no coinciden, asi que el aviso llegaba a
-- una persona distinta del titular. Se invierte la prioridad.
--
-- Orden: rut -> rut_solicitante_2 -> contacto. El contacto queda solo como
-- ultimo recurso, para los negocios cuyo RUT no trae correo (43 hoy); sin el,
-- esos clientes se quedarian sin ningun canal de aviso.
-- Cada candidato se valida por separado, para que un correo mal escrito en el
-- RUT no bloquee al siguiente.

create or replace function public.email_cliente_negocio(p_negocio_id uuid)
returns text
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with del_rut as (
    select lower(nullif(trim(nb.data->'campos'->'email'->>'value'),'')) as email
    from negocio_bloques nb
    join bloque_configs bc on bc.id = nb.bloque_config_id
    where nb.negocio_id = p_negocio_id
      and bc.slug in ('rut','rut_solicitante_2')
      and nullif(trim(nb.data->'campos'->'email'->>'value'),'') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    order by case bc.slug when 'rut' then 0 else 1 end
    limit 1
  ), del_contacto as (
    select lower(nullif(trim(c.email),'')) as email
    from negocios n
    join contactos c on c.id = n.contacto_id
    where n.id = p_negocio_id
      and nullif(trim(c.email),'') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
  select coalesce((select email from del_rut), (select email from del_contacto));
$function$;

-- La funcion la llama solo la edge function notificar-etapa, con service_role.
-- "create or replace" no toca los grants, asi que el revoke de
-- 20260813000002 sigue en pie; se repite aqui para que la migracion quede
-- explicita y no dependa de leer la anterior.
revoke execute on function public.email_cliente_negocio(uuid) from public, anon, authenticated;
