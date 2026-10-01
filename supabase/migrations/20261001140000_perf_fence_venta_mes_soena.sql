-- ============================================================
-- 20261001140000_perf_fence_venta_mes_soena
-- ============================================================
-- Rendimiento de la pestaña Comercial de SOENA. Solo cambia el PLAN de ejecucion,
-- no el resultado: el JSON que devuelve cada RPC queda identico.
--
-- Diagnostico (medido en produccion el 2026-10-01): cada RPC del mes tardaba ~1,25 s
-- aunque corriera sola, y la pagina dispara ~10 en paralelo sobre una instancia Micro
-- (p95 de 8 a 17 s). Filtran `v_venta_mes_comercial` con
-- `EXTRACT(YEAR/MONTH FROM v.fecha_venta) = p_anio/p_mes`; `fecha_venta` es un min()
-- calculado dentro de la vista, el planner estima 1 fila, elige nested loop y
-- re-ejecuta el subarbol pesado (v_negocio_valor / v_negocio_bonificable) ~60 veces.
--
-- Arreglo: leer la vista desde una subconsulta con `OFFSET 0`, que Postgres no aplana.
-- La vista se calcula UNA vez para el workspace y despues se filtra por fecha. El
-- filtro/join con `guard` (el control de acceso) queda intacto.
--
--   get_comercial_kpis_mes_soena       1406 -> 162 ms
--   get_comercial_origen_mes_soena     1246 -> 140 ms
--   get_comercial_plan_pago_mes_soena  1247 -> 154 ms
--   get_comercial_seccional_mes_soena  1273 -> 158 ms
--
-- Cada cuerpo es el VIVO de produccion, copiado mecanicamente: kpis y plan_pago de
-- su ultima migracion (md5 = produccion), origen y seccional de pg_get_functiondef
-- de produccion (el repo no coincide con lo vivo). Solo cambia la linea del FROM y se
-- agrega un comentario. No cambian firma, volatilidad, SECURITY DEFINER, search_path
-- ni grants (se reafirman los mismos).
--
-- Fuera A PROPOSITO: `get_comercial_pagos_mes_soena` y `get_comercial_ventas_mes_soena`.
-- Lo que corre en produccion es distinto del repo; aplicar la version del repo
-- cambiaria mas que la barrera. Deriva a reconciliar aparte.
-- ============================================================


-- ── get_comercial_kpis_mes_soena ──
-- Base: 20260902220053_tableros_honorario_neto_de_iva.sql + reescritura CURRENT_DATE -> public.hoy_bogota() de 20260927000001 (md5 del cuerpo = produccion)
CREATE OR REPLACE FUNCTION public.get_comercial_kpis_mes_soena(p_workspace_id uuid, p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas_mes AS (
    SELECT v.negocio_id, v.responsable_id, v.fecha_venta,
           v.honorario_con_iva, v.honorario_sin_iva, v.honorario_recaudado,
           v.primer_pago, v.segundo_pago, v.tarifa, v.caso_completo, v.bonificable
    -- OFFSET 0 = barrera de optimizacion A PROPOSITO (no limpiar): sin ella el planner subestima filas (fecha_venta es calculada) y re-ejecuta la vista una vez por fila.
    FROM (SELECT * FROM v_venta_mes_comercial WHERE workspace_id = p_workspace_id OFFSET 0) v, guard g
    WHERE v.workspace_id = g.id
      AND EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
  ),
  cancelados_mes AS (
    SELECT COUNT(*) AS n_perdidos
    FROM negocios n, guard g
    WHERE n.workspace_id = g.id AND n.estado = 'perdido'
      AND EXTRACT(YEAR  FROM n.updated_at) = p_anio
      AND EXTRACT(MONTH FROM n.updated_at) = p_mes
  ),
  tot AS (
    SELECT
      COUNT(*)                                             AS num_ventas,
      COALESCE(SUM(honorario_sin_iva), 0)                  AS valor_sin_iva,
      COALESCE(SUM(honorario_con_iva), 0)                  AS valor_con_iva,
      COALESCE(SUM(primer_pago), 0)                        AS primer_pago,
      COALESCE(SUM(segundo_pago), 0)                       AS segundo_pago,
      COALESCE(SUM(honorario_recaudado), 0)                AS honorario_recaudado,
      COALESCE(SUM(tarifa), 0)                             AS tarifa,
      COUNT(*) FILTER (WHERE caso_completo)                AS casos_completos,
      COUNT(*) FILTER (WHERE bonificable)                  AS bonificables,
      COUNT(*) FILTER (WHERE bonificable IS NULL)          AS bonificable_sin_medir
    FROM ventas_mes
  ),
  meta_global AS (
    SELECT meta_num_ventas, meta_valor
    FROM metas_comerciales mc, guard g
    WHERE mc.workspace_id = g.id AND mc.staff_id IS NULL
      AND mc.anio = p_anio AND mc.mes = p_mes
    LIMIT 1
  ),
  por_dia AS (
    SELECT fecha_venta::date AS dia, COUNT(*) AS ventas_dia
    FROM ventas_mes GROUP BY fecha_venta::date
  ),
  por_dia_vendedor AS (
    SELECT fecha_venta::date AS dia, responsable_id, COUNT(*) AS ventas_dia
    FROM ventas_mes GROUP BY fecha_venta::date, responsable_id
  ),
  mejor_dia AS (
    SELECT dia, ventas_dia FROM por_dia ORDER BY ventas_dia DESC, dia LIMIT 1
  )
  SELECT jsonb_build_object(
    'anio', p_anio,
    'mes', p_mes,
    'kpis', jsonb_build_object(
      'num_ventas',           (SELECT num_ventas FROM tot),
      'valor_sin_iva',        (SELECT valor_sin_iva FROM tot),
      'valor_con_iva',        (SELECT valor_con_iva FROM tot),
      'primer_pago',          (SELECT primer_pago FROM tot),
      'segundo_pago',         (SELECT segundo_pago FROM tot),
      'honorario_recaudado',  (SELECT honorario_recaudado FROM tot),
      'tarifa_recaudada',     (SELECT tarifa FROM tot),
      'casos_completos',      (SELECT casos_completos FROM tot),
      'tasa_casos_completos', CASE WHEN (SELECT num_ventas FROM tot) > 0
                                    THEN round(100.0 * (SELECT casos_completos FROM tot) / (SELECT num_ventas FROM tot), 1)
                                    ELSE NULL END,
      'bonificables',         CASE WHEN (SELECT num_ventas FROM tot) > 0
                                    AND (SELECT bonificable_sin_medir FROM tot) = (SELECT num_ventas FROM tot)
                                   THEN NULL ELSE (SELECT bonificables FROM tot) END,
      'bonificable_sin_medir',(SELECT bonificable_sin_medir FROM tot),
      'tasa_bonificables',    CASE WHEN (SELECT num_ventas FROM tot) - (SELECT bonificable_sin_medir FROM tot) > 0
                                    THEN round(100.0 * (SELECT bonificables FROM tot)
                                         / ((SELECT num_ventas FROM tot) - (SELECT bonificable_sin_medir FROM tot)), 1)
                                    ELSE NULL END,
      'ticket_promedio',      CASE WHEN (SELECT num_ventas FROM tot) > 0
                                    THEN round((SELECT valor_sin_iva FROM tot) / (SELECT num_ventas FROM tot), 0)
                                    ELSE 0 END,
      'mejor_dia',            (SELECT to_char(dia,'YYYY-MM-DD') FROM mejor_dia),
      'mejor_dia_ventas',     COALESCE((SELECT ventas_dia FROM mejor_dia), 0),
      'promedio_ventas_dia',  round((SELECT COALESCE(AVG(ventas_dia),0) FROM por_dia), 2),
      'ingreso_promedio_dia', CASE WHEN (SELECT COUNT(*) FROM por_dia) > 0
                                    THEN round((SELECT valor_sin_iva FROM tot) / (SELECT COUNT(*) FROM por_dia), 0)
                                    ELSE 0 END,
      'ventas_proyectadas',   CASE
        WHEN EXTRACT(YEAR FROM public.hoy_bogota()) = p_anio AND EXTRACT(MONTH FROM public.hoy_bogota()) = p_mes
          THEN round(
            (SELECT num_ventas FROM tot)::numeric
            * EXTRACT(DAY FROM (date_trunc('month', make_date(p_anio,p_mes,1)) + interval '1 month - 1 day'))
            / GREATEST(EXTRACT(DAY FROM public.hoy_bogota()), 1), 1)
        ELSE (SELECT num_ventas FROM tot) END,
      'n_perdidos',           (SELECT n_perdidos FROM cancelados_mes),
      'tasa_cancelacion',     CASE WHEN ((SELECT num_ventas FROM tot) + (SELECT n_perdidos FROM cancelados_mes)) > 0
                                    THEN round(100.0 * (SELECT n_perdidos FROM cancelados_mes)
                                         / ((SELECT num_ventas FROM tot) + (SELECT n_perdidos FROM cancelados_mes)), 1)
                                    ELSE NULL END,
      'tasa_recaudo',         CASE WHEN (SELECT valor_sin_iva FROM tot) > 0
                                    THEN round(100.0 * (SELECT honorario_recaudado FROM tot) / (SELECT valor_sin_iva FROM tot), 1)
                                    ELSE NULL END,
      'meta_num_ventas',      (SELECT meta_num_ventas FROM meta_global),
      'meta_valor',           (SELECT meta_valor FROM meta_global),
      'cumplimiento_num',     CASE WHEN (SELECT meta_num_ventas FROM meta_global) > 0
                                    THEN round(100.0 * (SELECT num_ventas FROM tot) / (SELECT meta_num_ventas FROM meta_global), 1)
                                    ELSE NULL END,
      'cumplimiento_valor',   CASE WHEN (SELECT meta_valor FROM meta_global) > 0
                                    THEN round(100.0 * (SELECT valor_sin_iva FROM tot) / (SELECT meta_valor FROM meta_global), 1)
                                    ELSE NULL END
    ),
    'porDia', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dia', to_char(dia,'YYYY-MM-DD'), 'ventas', ventas_dia) ORDER BY dia)
      FROM por_dia
    ), '[]'::jsonb),
    'porDiaVendedor', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'dia', to_char(dia,'YYYY-MM-DD'),
        'responsable_id', responsable_id,
        'ventas', ventas_dia
      ) ORDER BY dia, responsable_id NULLS LAST)
      FROM por_dia_vendedor
    ), '[]'::jsonb),
    'porVendedor', COALESCE((
      SELECT jsonb_agg(row ORDER BY nventas DESC, nombre)
      FROM (
        SELECT jsonb_build_object(
          'responsable_id',       vm.responsable_id,
          'nombre',               COALESCE(s.full_name, '(sin responsable)'),
          'sin_responsable',      vm.responsable_id IS NULL,
          'es_lider',             COALESCE(bool_or(pf.role IN ('owner','admin','supervisor')), false),
          'num_ventas',           COUNT(*),
          'valor_sin_iva',        COALESCE(SUM(vm.honorario_sin_iva), 0),
          'valor_con_iva',        COALESCE(SUM(vm.honorario_con_iva), 0),
          'primer_pago',          COALESCE(SUM(vm.primer_pago), 0),
          'segundo_pago',         COALESCE(SUM(vm.segundo_pago), 0),
          'casos_completos',      COUNT(*) FILTER (WHERE vm.caso_completo),
          'tasa_casos_completos', CASE WHEN COUNT(*) > 0
                                       THEN round(100.0 * COUNT(*) FILTER (WHERE vm.caso_completo) / COUNT(*), 1)
                                       ELSE NULL END,
          'bonificables',         CASE WHEN COUNT(*) = COUNT(*) FILTER (WHERE vm.bonificable IS NULL)
                                       THEN NULL ELSE COUNT(*) FILTER (WHERE vm.bonificable) END,
          'participacion_pct',    CASE WHEN (SELECT num_ventas FROM tot) > 0
                                       THEN round(100.0 * COUNT(*) / (SELECT num_ventas FROM tot), 1)
                                       ELSE NULL END,
          'meta_num_ventas',      mv.meta_num_ventas,
          'meta_valor',           mv.meta_valor
        ) AS row,
        COUNT(*) AS nventas,
        COALESCE(s.full_name, '(sin responsable)') AS nombre
        FROM ventas_mes vm
        LEFT JOIN staff s     ON s.id = vm.responsable_id
        LEFT JOIN profiles pf ON pf.id = s.profile_id
        LEFT JOIN metas_comerciales mv ON mv.staff_id = vm.responsable_id
             AND mv.anio = p_anio AND mv.mes = p_mes
             AND mv.workspace_id = (SELECT id FROM guard)
        GROUP BY vm.responsable_id, s.full_name, mv.meta_num_ventas, mv.meta_valor
      ) t
    ), '[]'::jsonb)
  );
$function$;

revoke execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) to authenticated;


-- ── get_comercial_plan_pago_mes_soena ──
-- Base: 20260826000002_filtro_por_vendedor_tablero_comercial.sql (md5 del cuerpo = produccion)
CREATE OR REPLACE FUNCTION public.get_comercial_plan_pago_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer,
  p_responsable_id uuid DEFAULT NULL,
  p_sin_responsable boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas AS (
    SELECT
      v.negocio_id, v.plan_pago,
      v.honorario_sin_iva, v.honorario_con_iva,
      v.primer_pago, v.segundo_pago, v.honorario_recaudado,
      v.caso_completo, v.bonificable
    -- OFFSET 0 = barrera de optimizacion A PROPOSITO (no limpiar): sin ella el planner subestima filas (fecha_venta es calculada) y re-ejecuta la vista una vez por fila.
    FROM (SELECT * FROM v_venta_mes_comercial WHERE workspace_id = p_workspace_id OFFSET 0) v
    JOIN guard g ON v.workspace_id = g.id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
      AND (p_responsable_id IS NULL OR v.responsable_id = p_responsable_id)
      AND (NOT p_sin_responsable OR v.responsable_id IS NULL)
  )
  SELECT jsonb_build_object(
    'total_ventas', (SELECT COUNT(*) FROM ventas),
    'filas', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'plan_pago')::int NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
          'plan_pago',        plan_pago,
          'ventas',           COUNT(*),
          'valor_sin_iva',    COALESCE(SUM(honorario_sin_iva), 0),
          'valor_con_iva',    COALESCE(SUM(honorario_con_iva), 0),
          'primer_pago',      COALESCE(SUM(primer_pago), 0),
          'segundo_pago',     CASE WHEN plan_pago = 1 THEN COALESCE(SUM(segundo_pago), 0) END,
          'recaudado',        COALESCE(SUM(honorario_recaudado), 0),
          'casos_completos',  COUNT(*) FILTER (WHERE caso_completo),
          'bonificables',     CASE WHEN COUNT(*) = COUNT(*) FILTER (WHERE bonificable IS NULL)
                                   THEN NULL ELSE COUNT(*) FILTER (WHERE bonificable) END,
          'negocio_ids',      jsonb_agg(negocio_id)
        ) AS x
        FROM ventas
        GROUP BY plan_pago
      ) t
    ), '[]'::jsonb)
  );
$function$;

revoke execute on function public.get_comercial_plan_pago_mes_soena(uuid, integer, integer, uuid, boolean) from public, anon;
grant  execute on function public.get_comercial_plan_pago_mes_soena(uuid, integer, integer, uuid, boolean) to authenticated;


-- ── get_comercial_origen_mes_soena ──
-- Base: pg_get_functiondef de PRODUCCION (2026-10-01) + la barrera; el repo no coincide con prod.
CREATE OR REPLACE FUNCTION public.get_comercial_origen_mes_soena(p_workspace_id uuid, p_anio integer, p_mes integer, p_responsable_id uuid DEFAULT NULL::uuid, p_sin_responsable boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas AS (
    SELECT v.negocio_id, v.honorario_sin_iva, v.honorario_recaudado,
           COALESCE(a.tiene_rastro_meta, false) AS tiene_rastro_meta,
           a.campana,
           v.origen_declarado,
           COALESCE(a.atribucion_en_conflicto, false) AS en_conflicto,
           COALESCE(a.comision_retenida, false)       AS comision_retenida
    -- OFFSET 0 = barrera de optimizacion A PROPOSITO (no limpiar): sin ella el planner subestima filas (fecha_venta es calculada) y re-ejecuta la vista una vez por fila.
    FROM (SELECT * FROM v_venta_mes_comercial WHERE workspace_id = p_workspace_id OFFSET 0) v
    JOIN guard g ON v.workspace_id = g.id
    LEFT JOIN v_negocio_atribucion a ON a.negocio_id = v.negocio_id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
      AND (p_responsable_id IS NULL OR v.responsable_id = p_responsable_id)
      AND (NOT p_sin_responsable OR v.responsable_id IS NULL)
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM ventas),
    'con_rastro_meta',  (SELECT COUNT(*) FROM ventas WHERE tiene_rastro_meta),
    'sin_rastro',       (SELECT COUNT(*) FROM ventas WHERE NOT tiene_rastro_meta),
    'meta_sin_campana', (SELECT COUNT(*) FROM ventas WHERE tiene_rastro_meta AND campana IS NULL),
    'en_conflicto',     (SELECT COUNT(*) FROM ventas WHERE en_conflicto),
    'comision_retenida',            (SELECT COUNT(*) FROM ventas WHERE comision_retenida),
    'comision_retenida_valor',      (SELECT COALESCE(SUM(honorario_sin_iva),0) FROM ventas WHERE comision_retenida),
    'por_origen', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'origen')
      FROM (
        SELECT jsonb_build_object(
          'origen',       origen_declarado,
          'ventas',       COUNT(*),
          'valor_sin_iva', COALESCE(SUM(honorario_sin_iva), 0),
          'recaudado',    COALESCE(SUM(honorario_recaudado), 0),
          'con_rastro_meta', COUNT(*) FILTER (WHERE tiene_rastro_meta),
          'comision_retenida', COUNT(*) FILTER (WHERE comision_retenida)
        ) AS x
        FROM ventas
        GROUP BY origen_declarado
      ) t
    ), '[]'::jsonb),
    'por_campana', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'ventas')::int DESC, x->>'campana')
      FROM (
        SELECT jsonb_build_object(
          'campana',      campana,
          'ventas',       COUNT(*),
          'valor_sin_iva', COALESCE(SUM(honorario_sin_iva), 0),
          'recaudado',    COALESCE(SUM(honorario_recaudado), 0)
        ) AS x
        FROM ventas
        WHERE tiene_rastro_meta
        GROUP BY campana
      ) t
    ), '[]'::jsonb)
  );
$function$;

revoke execute on function public.get_comercial_origen_mes_soena(uuid, integer, integer, uuid, boolean) from public, anon;
grant  execute on function public.get_comercial_origen_mes_soena(uuid, integer, integer, uuid, boolean) to authenticated;


-- ── get_comercial_seccional_mes_soena ──
-- Base: pg_get_functiondef de PRODUCCION (2026-10-01) + la barrera; el repo no coincide con prod.
CREATE OR REPLACE FUNCTION public.get_comercial_seccional_mes_soena(p_workspace_id uuid, p_anio integer, p_mes integer, p_responsable_id uuid DEFAULT NULL::uuid, p_sin_responsable boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas AS (
    SELECT
      v.negocio_id,
      NULLIF(TRIM(n.metadata->>'seccional'), '') AS seccional_cruda,
      v.honorario_sin_iva, v.honorario_con_iva,
      v.primer_pago, v.segundo_pago, v.honorario_recaudado,
      v.caso_completo, v.bonificable
    -- OFFSET 0 = barrera de optimizacion A PROPOSITO (no limpiar): sin ella el planner subestima filas (fecha_venta es calculada) y re-ejecuta la vista una vez por fila.
    FROM (SELECT * FROM v_venta_mes_comercial WHERE workspace_id = p_workspace_id OFFSET 0) v
    JOIN guard g ON v.workspace_id = g.id
    JOIN negocios n ON n.id = v.negocio_id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
      AND (p_responsable_id IS NULL OR v.responsable_id = p_responsable_id)
      AND (NOT p_sin_responsable OR v.responsable_id IS NULL)
  )
  SELECT jsonb_build_object(
    'total_ventas', (SELECT COUNT(*) FROM ventas),
    'filas', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'ventas')::int DESC, x->>'seccional_cruda' NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
          'seccional_cruda',  seccional_cruda,
          'ventas',           COUNT(*),
          'valor_sin_iva',    COALESCE(SUM(honorario_sin_iva), 0),
          'valor_con_iva',    COALESCE(SUM(honorario_con_iva), 0),
          'primer_pago',      COALESCE(SUM(primer_pago), 0),
          'segundo_pago',     COALESCE(SUM(segundo_pago), 0),
          'recaudado',        COALESCE(SUM(honorario_recaudado), 0),
          'casos_completos',  COUNT(*) FILTER (WHERE caso_completo),
          'bonificables',     CASE WHEN COUNT(*) = COUNT(*) FILTER (WHERE bonificable IS NULL)
                                   THEN NULL ELSE COUNT(*) FILTER (WHERE bonificable) END,
          'negocio_ids',      jsonb_agg(negocio_id)
        ) AS x
        FROM ventas
        GROUP BY seccional_cruda
      ) t
    ), '[]'::jsonb)
  );
$function$;

revoke execute on function public.get_comercial_seccional_mes_soena(uuid, integer, integer, uuid, boolean) from public, anon;
grant  execute on function public.get_comercial_seccional_mes_soena(uuid, integer, integer, uuid, boolean) to authenticated;
