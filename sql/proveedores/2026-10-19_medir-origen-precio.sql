-- De dónde sale el precio de las líneas de viaje de un espacio (SOLO LECTURA).
--
-- Criterio de Hana (brief del 2026-10-19): % de líneas con precio desde tarifa extraída, desde
-- pantallazo y a mano. Sale de `items.tarifa_pax`:
--   · tarifa_extraida: la casilla 1 la escribió la elección de tarifas del proveedor
--     (`origen = 'tarifario'`); el detalle (extracción, filas, canal) está en `tarifa_pax.tarifaExtraida`.
--   · ingreso_manual: la casilla 1 la escribió el formulario de ingreso manual (`origen = 'manual'`).
--   · pantallazo: la casilla 1 (o las habitaciones) salieron de un pantallazo.
--   · costo_a_mano: sin lectura, con costo escrito en la casilla de costo (`items.subtotal`).
--   · sin_costo: nada de lo anterior.
-- Reemplazar <workspace_id> (filtro de espacio obligatorio). Correr por MCP execute_sql.

with lineas as (
  select
    i.id,
    case
      when i.tarifa_pax -> 'casillas' -> 'grupo_completo' ->> 'origen' = 'tarifario' then 'tarifa_extraida'
      when i.tarifa_pax -> 'casillas' -> 'grupo_completo' ->> 'origen' = 'manual' then 'ingreso_manual'
      when i.tarifa_pax -> 'casillas' -> 'grupo_completo' is not null
        or jsonb_typeof(i.tarifa_pax -> 'habitaciones') = 'array' then 'pantallazo'
      when coalesce(i.subtotal, 0) > 0 then 'costo_a_mano'
      else 'sin_costo'
    end as origen
  from public.items i
  join public.cotizaciones c on c.id = i.cotizacion_id
  where c.workspace_id = '<workspace_id>'
    and i.grupo is not null
    and coalesce(i.es_ajuste, false) = false
)
select origen,
       count(*) as lineas,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from lineas
group by origen
order by lineas desc;

-- El detalle de las que vienen de tarifa extraída: qué proveedor, qué extracción y cuántas filas.
-- select i.id, i.tarifa_pax -> 'tarifaExtraida' ->> 'proveedor_id' as proveedor_id,
--        i.tarifa_pax -> 'tarifaExtraida' ->> 'extraccion_id' as extraccion_id,
--        jsonb_array_length(i.tarifa_pax -> 'tarifaExtraida' -> 'filas') as filas,
--        i.tarifa_pax -> 'tarifaExtraida' ->> 'canal' as canal
--   from public.items i join public.cotizaciones c on c.id = i.cotizacion_id
--  where c.workspace_id = '<workspace_id>'
--    and i.tarifa_pax -> 'casillas' -> 'grupo_completo' ->> 'origen' = 'tarifario';
