-- Extraer en Postgres los pocos campos que la tarjeta de /negocios necesita de
-- los bloques, en vez de traerse el jsonb entero para leerlos en JS.
--
-- Medido contra produccion el 2026-08-21, workspace soena, 268 negocios
-- abiertos. La consulta de hoy (`select negocio_id, data, bloque_configs(nombre)`)
-- trae 2.150 filas y 1.153 kB de jsonb para producir cuatro cadenas cortas por
-- negocio: cedula, radicado, numero de factura y vehiculo/ciudad. El resto del
-- blob — el detalle completo de cada bloque, con `manual` y `confidence` por
-- campo — viaja por la red y se descarta en el mismo render.
--
-- Esta funcion devuelve solo los pares (campo, valor) pedidos, ya recortados y
-- normalizados: 2.406 filas, ~149 kB. Un septimo de los datos por la misma
-- respuesta.
--
-- `security invoker` es el default; se declara explicito porque aqui importa:
-- la RLS que aplica es la del usuario que llama, igual que en la consulta que
-- reemplaza. Un bug aqui seria un bug de aislamiento entre workspaces.

create or replace function negocio_bloques_campos(
  p_negocio_ids uuid[],
  p_bloques text[],
  p_campos text[]
)
returns table (negocio_id uuid, bloque_nombre text, campo text, valor text)
language sql
stable
security invoker
set search_path = public
as $$
  select
    nb.negocio_id,
    bc.nombre as bloque_nombre,
    e.key as campo,
    nullif(btrim(coalesce(e.value ->> 'value', e.value #>> '{}')), '') as valor
  from negocio_bloques nb
  join bloque_configs bc on bc.id = nb.bloque_config_id
  cross join lateral (
    -- Dos formas conviven en `data`: el valor bajo `campos.<slug>.value` y, en
    -- bloques viejos, la clave suelta en la raiz. Se leen las dos; quien consume
    -- se queda con la primera con valor, igual que antes.
    select k.key, k.value
    from jsonb_each(coalesce(nb.data -> 'campos', '{}'::jsonb)) k
    where k.key = any(p_campos)
    union all
    select k.key, k.value
    from jsonb_each(nb.data) k
    where k.key = any(p_campos)
  ) e
  where nb.negocio_id = any(p_negocio_ids)
    and bc.nombre = any(p_bloques)
    and nullif(btrim(coalesce(e.value ->> 'value', e.value #>> '{}')), '') is not null;
$$;

comment on function negocio_bloques_campos(uuid[], text[], text[]) is
  'Campos de bloques recortados para la tarjeta de /negocios. Evita traer el jsonb completo (medido en soena: 1.153 kB -> ~149 kB).';
