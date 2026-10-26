-- ============================================================
-- 20261018190000_perf_pagos_mes_soena_plan_custom
-- ============================================================
-- Rendimiento de get_comercial_pagos_mes_soena (pestaña Comercial de SOENA). Es el
-- pendiente que dejo 20261001160000 (#982): la barrera OFFSET 0 arreglo ventas, pero
-- pagos siguio igual de lento.
--
-- Diagnostico (EXPLAIN ANALYZE en produccion, 2026-10-18, JWT de SOENA, mes 2026-09):
--
--   * La funcion es LANGUAGE sql. En PostgreSQL 17 una funcion sql que no se inlinea
--     (esta no se inlinea por SECURITY DEFINER) planifica su consulta con los
--     parametros como incognitas: es siempre un plan GENERICO. Reproducido con
--     PREPARE + plan_cache_mode = force_generic_plan: 5,3 s y 911.085 buffers, lo mismo
--     que tarda la funcion (5,31 s, 914.891 buffers).
--   * Con make_date($2,$3,1) desconocido, el planner estima ~1 cobro en el mes y mete
--     un nested loop DENTRO de v_cobro_valor: re-ejecuta el subarbol de negocios/propuesta
--     (710 filas, ~60 ms) una vez por cobro. Fueron 82 vueltas, 5 s.
--   * La misma consulta con plan CUSTOM (los valores reales a la vista del planner)
--     elige hash joins: ~120 ms de ejecucion + ~24 ms de planeacion. No es la vista ni
--     el join con `guard`, como sospechaba #982. Es el plan generico.
--
-- Arreglo: la funcion pasa a plpgsql con `SET plan_cache_mode = force_custom_plan`.
-- plpgsql si usa el plan cache, y con ese ajuste replanea cada llamada con los valores
-- reales. La consulta es LA MISMA, letra por letra, con un cambio a proposito:
--
--   * ORDER BY gana `cv.cobro_id` como desempate final. Antes los cobros con la misma
--     fecha y el mismo monto salian en un orden que dependia del plan: en 8 de los 11
--     meses el orden de los empates cambia entre el plan generico y el custom (el
--     CONJUNTO es identico en los 11). Con el desempate el orden es total y no depende
--     del plan.
--
-- Equivalencia medida en produccion (2026-10-18, JWT de SOENA, 2025-12 a 2026-10):
-- n de cobros y md5 del conjunto (elementos ordenados como texto) identicos en los 11
-- meses entre la funcion actual y la consulta con plan custom. El md5 esperado de la
-- funcion nueva (salida exacta) es el de la salida actual re-ordenada por
-- (fecha desc, monto desc, cobro_id); va en el PR para verificar despues de aplicar.
--
-- No cambian firma, retorno, volatilidad, SECURITY DEFINER, search_path, comment ni
-- grants (se reafirman los mismos).
-- ============================================================

create or replace function public.get_comercial_pagos_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer
) returns jsonb
language plpgsql stable security definer
set search_path to 'public'
-- force_custom_plan = A PROPOSITO (no limpiar): con plan generico el planner no ve el mes
-- y re-ejecuta v_cobro_valor una vez por cobro (5 s en vez de ~0,15 s).
set plan_cache_mode to 'force_custom_plan'
as $function$
BEGIN
  RETURN (
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + interval '1 month')::date AS hasta
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'cobro_id',    cv.cobro_id,
      'fecha',       cv.fecha,
      'monto',       cv.monto,
      'honorario',   cv.a_tramo1 + cv.a_tramo2,
      'a_tramo1',    cv.a_tramo1,
      'a_tramo2',    cv.a_tramo2,
      'a_tarifa',    cv.a_tarifa,
      'excedente',   cv.excedente,
      'negocio_id',  cv.negocio_id,
      'codigo',      n.codigo,
      'nombre',      n.nombre,
      -- De que mes es la VENTA a la que se abona. Es la columna que explica por que la
      -- lista de ventas del mes no puede reconstruir esta barra.
      'fecha_venta', vm.fecha_venta
    ) ORDER BY cv.fecha DESC, cv.monto DESC, cv.cobro_id)
    FROM v_cobro_valor cv
    JOIN guard g ON cv.workspace_id = g.id
    CROSS JOIN rango r
    LEFT JOIN negocios n                ON n.id = cv.negocio_id
    -- OFFSET 0 = barrera de optimizacion A PROPOSITO (no limpiar): sin ella el planner subestima filas (fecha_venta es calculada) y re-ejecuta la vista una vez por fila.
    LEFT JOIN (SELECT * FROM v_venta_mes_comercial WHERE workspace_id = p_workspace_id OFFSET 0) vm ON vm.negocio_id = cv.negocio_id
    WHERE cv.fecha >= r.desde AND cv.fecha < r.hasta
  ), '[]'::jsonb)
  );
END;
$function$;

comment on function public.get_comercial_pagos_mes_soena(uuid, integer, integer) is
  'Los cobros que entraron en un mes, con la imputacion de v_cobro_valor (tramo 1, '
  'tarifa, tramo 2, excedente) y el mes de la venta a la que se abonan. Alimenta el '
  'panel de las dos barras de recaudo del historico. server-only.';

revoke execute on function public.get_comercial_pagos_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_pagos_mes_soena(uuid, integer, integer) to authenticated;
