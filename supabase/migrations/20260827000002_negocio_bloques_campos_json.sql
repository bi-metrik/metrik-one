-- La tarjeta de /negocios perdia campos en silencio por tamano de respuesta.
--
-- `negocio_bloques_campos` devuelve UNA FILA POR (negocio, bloque, campo). Con 372
-- negocios abiertos y los cinco bloques/ocho campos que la tarjeta de SOENA pide, eso
-- son **3.316 filas** en una sola respuesta REST. La respuesta se corta antes del
-- final, y lo que se pierde es lo que el plan devuelve de ultimo.
--
-- Sintoma medido el 2026-08-27: el filtro de servicio contratado de la lista mostraba
-- "Completo (3)" cuando en la base hay 75 negocios abiertos con el dato. Las filas de
-- `servicio` empiezan en la posicion 2.890 de 3.316: caen justo en la cola cortada.
-- No es un bug del filtro: cedula y radicado venian perdiendo filas por lo mismo, solo
-- que menos, porque salen antes en el barrido.
--
-- Arreglo: devolver **una fila por negocio** con un jsonb {bloque: {campo: valor}}.
-- 372 filas en vez de 3.316. Ademas se piden PARES (bloque, campo) en vez del producto
-- cartesiano de cinco bloques por ocho campos, que traia combinaciones que nadie usa
-- (el numero de factura leido del bloque RUT, por ejemplo).
--
-- La regla de negocio no cambia: un mismo bloque existe varias veces por negocio (las
-- etapas siguientes guardan copias readonly que suelen llegar vacias) y **gana la
-- primera instancia con valor**. Antes ese desempate lo hacia el orden de llegada al
-- cliente, que no estaba garantizado; aqui queda explicito y estable:
-- `order by created_at, id`.
--
-- La funcion vieja se deja en pie: es la que usa el codigo desplegado hasta que este
-- cambio salga, y borrarla en la misma migracion dejaria la lista rota entre el
-- momento de aplicarla y el del deploy.
create or replace function public.negocio_bloques_campos_json(
  p_negocio_ids uuid[],
  p_pares jsonb   -- [{"bloque":"RUT","campo":"numero_identificacion"}, ...]
) returns table(negocio_id uuid, valores jsonb)
language sql
stable
set search_path to 'public'
as $function$
  with pares as (
    select p->>'bloque' as bloque, p->>'campo' as campo
      from jsonb_array_elements(coalesce(p_pares, '[]'::jsonb)) p
     where p->>'bloque' is not null and p->>'campo' is not null
  ),
  crudos as (
    select distinct on (nb.negocio_id, bc.nombre, e.key)
           nb.negocio_id,
           bc.nombre as bloque,
           e.key     as campo,
           nullif(btrim(coalesce(e.value ->> 'value', e.value #>> '{}')), '') as valor
      from negocio_bloques nb
      join bloque_configs bc on bc.id = nb.bloque_config_id
      join pares pp on pp.bloque = bc.nombre
      cross join lateral (
        select k.key, k.value
          from jsonb_each(coalesce(nb.data -> 'campos', '{}'::jsonb)) k
         where k.key = pp.campo
        union all
        select k.key, k.value
          from jsonb_each(coalesce(nb.data, '{}'::jsonb)) k
         where k.key = pp.campo
      ) e
     where nb.negocio_id = any(p_negocio_ids)
       and nullif(btrim(coalesce(e.value ->> 'value', e.value #>> '{}')), '') is not null
     order by nb.negocio_id, bc.nombre, e.key, nb.created_at, nb.id
  ),
  por_bloque as (
    select c.negocio_id, c.bloque, jsonb_object_agg(c.campo, c.valor) as campos
      from crudos c
     group by c.negocio_id, c.bloque
  )
  select b.negocio_id, jsonb_object_agg(b.bloque, b.campos) as valores
    from por_bloque b
   group by b.negocio_id;
$function$;

-- Nace ejecutable por PUBLIC y anon la alcanza por ahi; solo la sesion autenticada
-- debe poder llamarla. Es SECURITY INVOKER: las RLS de `negocio_bloques` siguen
-- decidiendo que ve cada quien.
revoke execute on function public.negocio_bloques_campos_json(uuid[], jsonb) from public, anon;
grant execute on function public.negocio_bloques_campos_json(uuid[], jsonb) to authenticated, service_role;
