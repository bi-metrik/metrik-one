-- Fichas de proveedor que pudo crear SOLA la tarjeta de la cotización (SOLO LECTURA).
--
-- Brief del 2026-10-20, punto 2: hasta este PR, pintar la tarjeta de una línea de hotel o de
-- actividad creaba su fila en `fotos_perfiles` (que ES la ficha del proveedor desde #1204) con el
-- nombre de la línea, aunque ese nombre lo hubiera escrito una persona («City Tour …»). Desde este
-- PR un servicio escrito a mano no crea nada al pintarse; las que ya se crearon quedan.
--
-- Lista las fichas con `origen = 'cotizacion'` (las que nacen al pintar, no las importadas ni las
-- creadas en Proveedores) con lo que tienen colgado, para que una persona decida cuáles borrar. No
-- se puede saber con certeza cuál nació de una línea escrita a mano: el negocio pudo borrarse (el de
-- la prueba del 2026-10-20 ya no existe). Por eso dice cuántas líneas VIVAS la nombran, escritas a
-- mano y leídas de un pantallazo, y `sin_rastro` = nada la usa ni le cuelga nada.
--
-- Reemplazar <workspace_id> (filtro de espacio obligatorio). Correr por MCP execute_sql. No borra.

with fichas as (
  select fp.*
  from public.fotos_perfiles fp
  where fp.workspace_id = '<workspace_id>'
    and fp.tipo in ('hotel', 'actividad')
    and fp.origen = 'cotizacion'
),
lineas as (
  -- Los nombres con que una línea viva puede nombrar a la ficha (el de la línea y los leídos).
  select
    i.id,
    i.proveedor_id,
    -- coalesce: sin `origen` (un pantallazo) el `=` da null, y «not null» no cuenta la línea.
    coalesce(i.tarifa_pax -> 'casillas' -> 'grupo_completo' ->> 'origen',
             i.tarifa_pax -> 'habitaciones' -> 0 -> 'lectura' ->> 'origen', '') = 'manual' as a_mano,
    array_remove(array[
      lower(btrim(i.nombre)),
      lower(btrim(i.tarifa_pax -> 'casillas' -> 'grupo_completo' ->> 'nombre')),
      lower(btrim(i.tarifa_pax -> 'casillas' -> 'grupo_completo' -> 'identidad' ->> 'hotel')),
      lower(btrim(i.tarifa_pax -> 'casillas' -> 'grupo_completo' -> 'identidad' ->> 'nombre')),
      lower(btrim(i.tarifa_pax -> 'habitaciones' -> 0 -> 'lectura' -> 'identidad' ->> 'hotel'))
    ], null) as nombres
  from public.items i
  join public.cotizaciones c on c.id = i.cotizacion_id
  where c.workspace_id = '<workspace_id>'
    and coalesce(i.es_ajuste, false) = false
)
select
  f.id,
  f.tipo,
  f.nombre,
  f.ciudad,
  f.created_at,
  s.full_name as creada_por,
  (select count(*) from lineas l where l.a_mano and lower(btrim(f.nombre)) = any (l.nombres)) as lineas_a_mano,
  (select count(*) from lineas l where not l.a_mano and lower(btrim(f.nombre)) = any (l.nombres)) as lineas_pantallazo,
  (select count(*) from lineas l where l.proveedor_id = f.id) as lineas_con_la_ficha_fijada,
  (select count(*) from public.fotos_catalogo fc
    where fc.workspace_id = f.workspace_id and fc.tipo = f.tipo and fc.clave = f.clave) as fotos,
  (select count(*) from public.fotos_perfiles_alias a where a.perfil_id = f.id) as alias,
  (select count(*) from public.proveedor_tarifarios t where t.workspace_id = f.workspace_id and t.proveedor_id = f.id) as tarifarios,
  (select count(*) from public.proveedor_extracciones x where x.workspace_id = f.workspace_id and x.proveedor_id = f.id) as extracciones,
  (select count(*) from public.proveedor_cuentas k where k.workspace_id = f.workspace_id and k.proveedor_id = f.id) as cuentas,
  (
    not exists (select 1 from lineas l where not l.a_mano and lower(btrim(f.nombre)) = any (l.nombres))
    and not exists (select 1 from lineas l where l.proveedor_id = f.id)
    and not exists (select 1 from public.fotos_catalogo fc where fc.workspace_id = f.workspace_id and fc.tipo = f.tipo and fc.clave = f.clave)
    and not exists (select 1 from public.fotos_perfiles_alias a where a.perfil_id = f.id)
    and not exists (select 1 from public.proveedor_tarifarios t where t.workspace_id = f.workspace_id and t.proveedor_id = f.id)
    and not exists (select 1 from public.proveedor_extracciones x where x.workspace_id = f.workspace_id and x.proveedor_id = f.id)
    and not exists (select 1 from public.proveedor_cuentas k where k.workspace_id = f.workspace_id and k.proveedor_id = f.id)
  ) as sin_rastro
from fichas f
left join public.staff s on s.id = f.created_by
order by sin_rastro desc, lineas_a_mano desc, f.created_at desc;
