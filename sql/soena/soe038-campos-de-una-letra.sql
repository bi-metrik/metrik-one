-- SOE-038 · Campos de documento corregidos a mano que quedaron con una sola letra.
--
-- SOLO LECTURA. No corrige nada: lista lo afectado para que Mauricio decida cómo y cuándo
-- se arregla cada valor (escribir en SOENA exige su «autorizo escribir en soena»).
--
-- Causa (PR de SOE-038): el campo guardaba en onBlur y quedaba desactivado mientras el
-- guardado viajaba; una pérdida de foco a mitad de palabra guardaba el prefijo y lo que
-- se seguía escribiendo no entraba.
--
-- Fuera de la lista, a propósito:
--   · dv, cantidad, cantidad_compradores, otros_nombres: un carácter es un valor legítimo
--     («1», «-»).
--   · escrituras de backend («Corrección sistémica …», «MeTRIK (…)»).
-- Una misma fila puede salir varias veces si el documento está en una casilla compartida
-- o en copias del bloque: se agrupa por negocio + campo y se listan los bloques.

select
  n.codigo                                         as negocio,
  bc.nombre                                        as documento,
  e.k                                              as campo,
  e.v->>'value'                                    as valor_guardado,
  e.v->'edicion'->>'editado_por_nombre'            as editado_por,
  (e.v->'edicion'->>'editado_en')::timestamptz     as editado_en,
  array_agg(distinct nb.id::text)                  as negocio_bloque_ids,
  bool_or((e.v->'edicion'->>'editado_en')::timestamptz = nb.completado_at)
                                                   as fue_el_guardado_que_completo_el_bloque
from negocios n
join negocio_bloques nb on nb.negocio_id = n.id
left join bloque_configs bc on bc.id = nb.bloque_config_id
cross join lateral jsonb_each(nb.data->'campos') as e(k, v)
where n.workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'  -- SOENA
  and jsonb_typeof(nb.data->'campos') = 'object'
  and (e.v->>'manual')::boolean is true
  and e.v->'edicion' is not null
  and length(trim(coalesce(e.v->>'value', ''))) = 1
  and e.k not in ('dv', 'cantidad', 'cantidad_compradores', 'otros_nombres')
  and e.v->'edicion'->>'editado_por_nombre' not like 'Corrección sistémica%'
  and e.v->'edicion'->>'editado_por_nombre' not like 'MeTRIK%'
group by 1, 2, 3, 4, 5, 6
order by editado_en;
