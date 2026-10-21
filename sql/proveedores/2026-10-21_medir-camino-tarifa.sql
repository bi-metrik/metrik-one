-- El camino «Usar tarifa de proveedor» (brief del 2026-10-21, «Medida»). SOLO LECTURA.
--
-- Sin activity_log: lo que hace falta queda en la propia línea, en `items.tarifa_pax.tarifaExtraida`:
--   · camino: 'linea_nueva' (la línea nació con la tarifa), 'linea' (panel de una línea sin costo),
--     'cambiar' («Cambiar el costo»). Las elegidas antes del 2026-10-21 no lo traen.
--   · segundos: de abrir la hoja a «Usar» (lo mide el navegador; tope 3600).
-- El % de líneas costeadas desde el tarifario es el de `2026-10-19_medir-origen-precio.sql`
-- (origen = 'tarifa_extraida'). Los clics no se guardan: el camino nuevo son 3 (abrir, el
-- proveedor, Usar) cuando la tarifa viene marcada; con «Detalles del costo» o cambiar la marcada,
-- uno más por cada uno.
-- Reemplazar <workspace_id> (filtro de espacio obligatorio). Correr por MCP execute_sql.

with elegidas as (
  select
    coalesce(i.tarifa_pax -> 'tarifaExtraida' ->> 'camino', 'antes_de_2026_10_21') as camino,
    nullif(i.tarifa_pax -> 'tarifaExtraida' ->> 'segundos', '')::numeric as segundos
  from public.items i
  join public.cotizaciones c on c.id = i.cotizacion_id
  where c.workspace_id = '<workspace_id>'
    and i.tarifa_pax -> 'casillas' -> 'grupo_completo' ->> 'origen' = 'tarifario'
    and i.tarifa_pax ? 'tarifaExtraida'
)
select camino,
       count(*) as lineas,
       percentile_cont(0.5) within group (order by segundos) as p50_segundos,
       percentile_cont(0.9) within group (order by segundos) as p90_segundos
from elegidas
group by camino
order by lineas desc;
