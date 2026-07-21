-- ============================================================
-- 20260721000002 — Tablero comercial: tabla por vendedor del mes,
--                   KPIs mensuales y series historicas (paridad Sheet SOENA)
-- ------------------------------------------------------------
-- Iteracion 2. Extiende el tablero comercial (migracion 20260720000001) para
-- IGUALAR y superar el dashboard "INDICADORES DE VENTA" de Google Sheets.
--
-- FUENTE DE "UNA VENTA" (definicion #1, fijada leyendo el esquema):
--   Una venta = una PROPUESTA ECONOMICA APROBADA (bloque de tipo
--   'propuesta_economica' con data.aprobado_at NOT NULL). Su FECHA es
--   data.aprobado_at (equivalente ONE de la "fecha de cierre" del Sheet).
--   El Sheet cuenta por fecha de cierre; en ONE la aprobacion de la propuesta
--   es el evento con timestamp confiable que fija el ingreso.
--   CANONICA: un negocio puede tener varias versiones/bloques de propuesta;
--   se toma UNA por negocio (DISTINCT ON negocio_id, la de aprobado_at mas
--   reciente) para NO inflar el conteo.
--
-- IVA (definicion #3): la propuesta guarda el honorario CON IVA en
--   data.aprobado_honorario y el IVA en data.iva_pct (guardado como fraccion,
--   ej. 0.19; algunos registros podrian traer 19). Se normaliza:
--       iva_frac = CASE WHEN iva_pct > 1 THEN iva_pct/100 ELSE iva_pct END  (default 0.19)
--       honorario_sin_iva = honorario_con_iva / (1 + iva_frac)
--   HEADLINE = honorario SIN IVA (ingreso limpio). "con IVA" es columna
--   secundaria para paridad con el Sheet.
--
-- PRIMER vs SEGUNDO PAGO (definicion #2): en SOENA los cobros NO usan
--   numero_cuota ni plan_cobro_id (ambos NULL hoy). El discriminador real es
--   tipo_cobro: 'anticipo' = PRIMER pago (50% del plan 50/50), 'pago' = pago
--   unico del plan 2 (cuenta como primer pago tambien, el negocio queda saldado).
--   SEGUNDO pago = cobro de saldo del 50/50; hoy no existe ninguno. Se modela:
--       primer_pago  = cobros 'anticipo' + 'pago' (no pasante)
--       segundo_pago = cobros 'saldo' (no pasante)  [aparece cuando exista]
--   La tarifa UPME (tipo_cobro='pasante') queda SIEMPRE fuera (plata de terceros).
--
-- CASO COMPLETO (definicion #4): negocio saldado = recaudo honorario >=
--   honorario esperado (sin IVA), tolerancia 1 peso. (No hay completado_at
--   confiable; el saldo cero del honorario es la senal operativa.)
--
-- TASA DE CANCELACION (definicion #5): negocios.estado = 'perdido' sobre el
--   total del universo del mes. En el flujo VE, perder marca estado='perdido'
--   (tipo_cierre/cierre_motivo aun no se pueblan; estado es la senal fiable).
--
-- TASA DE RECAUDO (definicion #6): honorario recaudado (sin IVA) / honorario
--   esperado (sin IVA) de negocios con propuesta aprobada, MISMO universo en
--   numerador y denominador. CAVEAT: el Sheet reporta 70.1% global; con los
--   datos parciales de hoy la cifra NO reconcilia (el honorario recaudado aun
--   arrastra tarifa por el Grupo 3 sin reclasificar a 'pasante' -> puede pasar
--   de 100%). Se auto-corrige con la reclasificacion pendiente. Documentado, NO
--   se fuerza el numero.
--
-- Todo parametrizado por mes/rango. SECURITY DEFINER + check de pertenencia
-- (current_user_workspace_id). Idempotente. Rollback comentado al final.
-- ============================================================

-- ---------- RPC: KPIs + tabla por vendedor de UN mes ----------
DROP FUNCTION IF EXISTS public.get_comercial_kpis_mes_soena(uuid, integer, integer);

CREATE FUNCTION public.get_comercial_kpis_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  -- Propuesta canonica aprobada por negocio (una sola fila por negocio).
  ventas AS (
    SELECT DISTINCT ON (nb.negocio_id)
      nb.negocio_id,
      n.responsable_id,
      (nb.data->>'aprobado_at')::timestamptz                         AS aprobado_at,
      (nb.data->>'aprobado_honorario')::numeric                      AS honorario_con_iva,
      CASE
        WHEN COALESCE(NULLIF(nb.data->>'iva_pct','')::numeric, 0.19) > 1
          THEN COALESCE(NULLIF(nb.data->>'iva_pct','')::numeric, 0.19) / 100
        ELSE COALESCE(NULLIF(nb.data->>'iva_pct','')::numeric, 0.19)
      END                                                            AS iva_frac
    FROM negocio_bloques nb
    JOIN negocios n            ON n.id = nb.negocio_id
    JOIN guard g               ON n.workspace_id = g.id
    JOIN bloque_configs bc     ON bc.id = nb.bloque_config_id
    JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
    WHERE bd.tipo = 'propuesta_economica'
      AND (nb.data->>'aprobado_at') IS NOT NULL
    ORDER BY nb.negocio_id, (nb.data->>'aprobado_at')::timestamptz DESC
  ),
  -- Recaudo por negocio, desglosado. Coherente con v_pyl_mes (excluye pasante).
  recaudo AS (
    SELECT
      c.negocio_id,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')                    AS honorario_recaudado,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IN ('anticipo','pago'))                        AS primer_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'saldo')                                     AS segundo_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                                   AS tarifa
    FROM cobros c, guard g
    WHERE c.workspace_id = g.id AND c.fecha IS NOT NULL
    GROUP BY c.negocio_id
  ),
  -- Ventas del mes seleccionado (grano negocio) con honorario sin IVA + recaudo.
  ventas_mes AS (
    SELECT
      v.negocio_id,
      v.responsable_id,
      v.aprobado_at,
      v.honorario_con_iva,
      v.honorario_con_iva / (1 + v.iva_frac)                          AS honorario_sin_iva,
      COALESCE(r.honorario_recaudado, 0)                              AS honorario_recaudado,
      COALESCE(r.primer_pago, 0)                                      AS primer_pago,
      COALESCE(r.segundo_pago, 0)                                     AS segundo_pago,
      COALESCE(r.tarifa, 0)                                           AS tarifa,
      -- caso completo: recaudo honorario cubre el honorario sin IVA
      (COALESCE(r.honorario_recaudado, 0) >= v.honorario_con_iva / (1 + v.iva_frac) - 1) AS caso_completo
    FROM ventas v
    LEFT JOIN recaudo r ON r.negocio_id = v.negocio_id
    WHERE EXTRACT(YEAR  FROM v.aprobado_at) = p_anio
      AND EXTRACT(MONTH FROM v.aprobado_at) = p_mes
  ),
  -- Universo del mes (para tasa de cancelacion): negocios creados/actualizados
  -- que estan perdidos vs total. Aqui usamos las ventas del mes + perdidos del mes.
  cancelados_mes AS (
    SELECT COUNT(*) AS n_perdidos
    FROM negocios n, guard g
    WHERE n.workspace_id = g.id
      AND n.estado = 'perdido'
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
      COUNT(*) FILTER (WHERE caso_completo)                AS casos_completos
    FROM ventas_mes
  ),
  -- meta del mes: fila global (staff_id NULL) tiene prioridad para el KPI global.
  meta_global AS (
    SELECT meta_num_ventas, meta_valor
    FROM metas_comerciales mc, guard g
    WHERE mc.workspace_id = g.id AND mc.staff_id IS NULL
      AND mc.anio = p_anio AND mc.mes = p_mes
    LIMIT 1
  ),
  -- mejor dia (mas ventas) y promedio diario dentro del mes.
  por_dia AS (
    SELECT aprobado_at::date AS dia, COUNT(*) AS ventas_dia
    FROM ventas_mes GROUP BY aprobado_at::date
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
      'ticket_promedio',      CASE WHEN (SELECT num_ventas FROM tot) > 0
                                    THEN round((SELECT valor_sin_iva FROM tot) / (SELECT num_ventas FROM tot), 0)
                                    ELSE 0 END,
      'mejor_dia',            (SELECT to_char(dia,'YYYY-MM-DD') FROM mejor_dia),
      'mejor_dia_ventas',     COALESCE((SELECT ventas_dia FROM mejor_dia), 0),
      'promedio_ventas_dia',  round((SELECT COALESCE(AVG(ventas_dia),0) FROM por_dia), 2),
      'ingreso_promedio_dia', CASE WHEN (SELECT COUNT(*) FROM por_dia) > 0
                                    THEN round((SELECT valor_sin_iva FROM tot) / (SELECT COUNT(*) FROM por_dia), 0)
                                    ELSE 0 END,
      -- run-rate: ventas del mes proyectadas por dias transcurridos vs dias del mes.
      'ventas_proyectadas',   CASE
        WHEN EXTRACT(YEAR FROM CURRENT_DATE) = p_anio AND EXTRACT(MONTH FROM CURRENT_DATE) = p_mes
          THEN round(
            (SELECT num_ventas FROM tot)::numeric
            * EXTRACT(DAY FROM (date_trunc('month', make_date(p_anio,p_mes,1)) + interval '1 month - 1 day'))
            / GREATEST(EXTRACT(DAY FROM CURRENT_DATE), 1), 1)
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
    -- Tabla por vendedor del mes (incluye bucket sin responsable + fila con meta por vendedor).
    'porVendedor', COALESCE((
      SELECT jsonb_agg(row ORDER BY val DESC, nombre)
      FROM (
        SELECT jsonb_build_object(
          'responsable_id',       vm.responsable_id,
          'nombre',               COALESCE(s.full_name, '(sin responsable)'),
          'sin_responsable',      vm.responsable_id IS NULL,
          'num_ventas',           COUNT(*),
          'valor_sin_iva',        COALESCE(SUM(vm.honorario_sin_iva), 0),
          'valor_con_iva',        COALESCE(SUM(vm.honorario_con_iva), 0),
          'primer_pago',          COALESCE(SUM(vm.primer_pago), 0),
          'segundo_pago',         COALESCE(SUM(vm.segundo_pago), 0),
          'casos_completos',      COUNT(*) FILTER (WHERE vm.caso_completo),
          'tasa_casos_completos', CASE WHEN COUNT(*) > 0
                                       THEN round(100.0 * COUNT(*) FILTER (WHERE vm.caso_completo) / COUNT(*), 1)
                                       ELSE NULL END,
          'participacion_pct',    CASE WHEN (SELECT valor_sin_iva FROM tot) > 0
                                       THEN round(100.0 * COALESCE(SUM(vm.honorario_sin_iva),0) / (SELECT valor_sin_iva FROM tot), 1)
                                       ELSE NULL END,
          'meta_num_ventas',      (SELECT meta_num_ventas FROM metas_comerciales mc, guard g
                                    WHERE mc.workspace_id=g.id AND mc.staff_id=vm.responsable_id
                                      AND mc.anio=p_anio AND mc.mes=p_mes LIMIT 1),
          'meta_valor',           (SELECT meta_valor FROM metas_comerciales mc, guard g
                                    WHERE mc.workspace_id=g.id AND mc.staff_id=vm.responsable_id
                                      AND mc.anio=p_anio AND mc.mes=p_mes LIMIT 1)
        ) AS row,
        COALESCE(SUM(vm.honorario_sin_iva),0) AS val,
        COALESCE(s.full_name,'(sin responsable)') AS nombre
        FROM ventas_mes vm
        LEFT JOIN staff s ON s.id = vm.responsable_id
        GROUP BY vm.responsable_id, s.full_name
      ) t
    ), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_comercial_kpis_mes_soena(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comercial_kpis_mes_soena(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comercial_kpis_mes_soena(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_comercial_kpis_mes_soena(uuid, integer, integer) IS
  'KPIs mensuales + tabla por vendedor del mes para el tablero comercial. Venta = propuesta aprobada (aprobado_at). Honorario sin IVA headline. Cumplimiento vs metas_comerciales. SECURITY DEFINER con check de pertenencia.';


-- ---------- RPC: series historicas por mes ----------
DROP FUNCTION IF EXISTS public.get_comercial_serie_mensual_soena(uuid, integer);

-- p_meses: cuantos meses hacia atras desde el mes actual (default 12).
CREATE FUNCTION public.get_comercial_serie_mensual_soena(
  p_workspace_id uuid,
  p_meses integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  meses AS (
    SELECT date_trunc('month', CURRENT_DATE) - (n || ' month')::interval AS mes_ini
    FROM generate_series(0, GREATEST(p_meses,1) - 1) n
  ),
  ventas AS (
    SELECT DISTINCT ON (nb.negocio_id)
      nb.negocio_id,
      (nb.data->>'aprobado_at')::timestamptz AS aprobado_at,
      (nb.data->>'aprobado_honorario')::numeric AS honorario_con_iva,
      CASE
        WHEN COALESCE(NULLIF(nb.data->>'iva_pct','')::numeric, 0.19) > 1
          THEN COALESCE(NULLIF(nb.data->>'iva_pct','')::numeric, 0.19) / 100
        ELSE COALESCE(NULLIF(nb.data->>'iva_pct','')::numeric, 0.19)
      END AS iva_frac
    FROM negocio_bloques nb
    JOIN negocios n            ON n.id = nb.negocio_id
    JOIN guard g               ON n.workspace_id = g.id
    JOIN bloque_configs bc     ON bc.id = nb.bloque_config_id
    JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
    WHERE bd.tipo = 'propuesta_economica' AND (nb.data->>'aprobado_at') IS NOT NULL
    ORDER BY nb.negocio_id, (nb.data->>'aprobado_at')::timestamptz DESC
  ),
  ventas_por_mes AS (
    SELECT
      date_trunc('month', aprobado_at) AS mes_ini,
      COUNT(*) AS num_ventas,
      SUM(honorario_con_iva / (1 + iva_frac)) AS valor_sin_iva,
      SUM(honorario_con_iva)                  AS valor_con_iva
    FROM ventas GROUP BY 1
  ),
  -- recaudo por mes del pago (fecha del cobro), desglosado primer/segundo.
  recaudo_por_mes AS (
    SELECT
      date_trunc('month', c.fecha) AS mes_ini,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')       AS honorario_recaudado,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IN ('anticipo','pago'))           AS primer_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'saldo')                        AS segundo_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                      AS tarifa
    FROM cobros c, guard g
    WHERE c.workspace_id = g.id AND c.fecha IS NOT NULL
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio',                EXTRACT(YEAR  FROM m.mes_ini)::int,
        'mes',                 EXTRACT(MONTH FROM m.mes_ini)::int,
        'label',               to_char(m.mes_ini, 'Mon YY'),
        'num_ventas',          COALESCE(vm.num_ventas, 0),
        'valor_sin_iva',       COALESCE(vm.valor_sin_iva, 0),
        'valor_con_iva',       COALESCE(vm.valor_con_iva, 0),
        'honorario_recaudado', COALESCE(rm.honorario_recaudado, 0),
        'primer_pago',         COALESCE(rm.primer_pago, 0),
        'segundo_pago',        COALESCE(rm.segundo_pago, 0),
        'tarifa_recaudada',    COALESCE(rm.tarifa, 0)
      ) ORDER BY m.mes_ini)
      FROM meses m
      LEFT JOIN ventas_por_mes  vm ON vm.mes_ini = m.mes_ini
      LEFT JOIN recaudo_por_mes rm ON rm.mes_ini = m.mes_ini
    ), '[]'::jsonb),
    -- tasa de recaudo global del rango (honorario recaudado / esperado, mismo universo).
    'tasa_recaudo_global', (
      SELECT CASE WHEN SUM(vm.valor_sin_iva) > 0
                  THEN round(100.0 * COALESCE((SELECT SUM(honorario_recaudado) FROM recaudo_por_mes), 0)
                       / SUM(vm.valor_sin_iva), 1)
                  ELSE NULL END
      FROM ventas_por_mes vm
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_comercial_serie_mensual_soena(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comercial_serie_mensual_soena(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comercial_serie_mensual_soena(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.get_comercial_serie_mensual_soena(uuid, integer) IS
  'Series historicas por mes (ventas, valor con/sin IVA, recaudo, primer/segundo pago) + tasa de recaudo global. SECURITY DEFINER con check de pertenencia.';

-- ============================================================
-- ROLLBACK (comentado):
--   DROP FUNCTION IF EXISTS public.get_comercial_kpis_mes_soena(uuid, integer, integer);
--   DROP FUNCTION IF EXISTS public.get_comercial_serie_mensual_soena(uuid, integer);
-- ============================================================
