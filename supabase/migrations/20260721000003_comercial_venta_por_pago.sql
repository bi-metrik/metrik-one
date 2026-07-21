-- ============================================================
-- 20260721000003 — Redefinir "venta" = primer pago de honorario recibido
-- ------------------------------------------------------------
-- CORRECCION DE FONDO (Daniela SOENA + Mauricio, 2026-07-21). Reemplaza el
-- ancla de la iteracion 1/2 (venta = propuesta aprobada por data.aprobado_at).
--
-- NUEVA DEFINICION DE VENTA:
--   "Una venta = cuando el cliente le paga a SOENA" (primer pago de HONORARIO).
--   - fecha_venta(negocio) = MIN(cobros.fecha)
--        WHERE cobros.fecha IS NOT NULL AND cobros.tipo_cobro <> 'pasante'
--     (la tarifa Boome/UPME 'pasante' NO cuenta como venta ni entra jamas al
--      desempeno comercial; IS DISTINCT FROM 'pasante' es null-safe).
--   - Un negocio es VENTA solo si tiene >= 1 pago de honorario recibido.
--     Sin pago -> NO es venta, NO aparece en la estadistica comercial.
--   - "Ventas del mes" = negocios cuya fecha_venta cae en ese mes.
--
-- Divergencia medida: julio 2026 daba 21 con la def vieja (aprobado_at) vs
-- 18 con la correcta (primer pago). Total historico 28 ventas (feb->jul).
--
-- VALOR de la venta: el honorario aprobado de la propuesta canonica del negocio
--   (con/sin IVA) SOLO aporta el monto; ya NO determina si es venta. Se sigue
--   tomando la propuesta canonica por negocio (DISTINCT ON, la de aprobado_at
--   mas reciente). IVA: iva_pct guardado como fraccion (0.19; normaliza >1 -> /100).
--   Headline = honorario SIN IVA.
--
-- PRIMER vs SEGUNDO PAGO (pagos partidos -> "pago uno"): varios pagos parciales
--   de honorario del cliente se AGREGAN al PRIMER pago (no importa el tipo_cobro
--   anticipo/pago). El "segundo pago" es el saldo del 50/50 (tipo_cobro='saldo'),
--   que hoy no existe. Boome (pasante) NUNCA entra en 1er/2o pago.
--     primer_pago  = SUM(cobros.monto) WHERE tipo_cobro <> 'pasante' AND <> 'saldo'
--     segundo_pago = SUM(cobros.monto) WHERE tipo_cobro = 'saldo'
--   (antes primer=anticipo+pago; ahora primer = todo honorario que no sea saldo,
--    para resistir pagos partidos con cualquier etiqueta).
--
-- RANKING: la metrica PRIMARIA pasa a numero de ventas del periodo (negocios
--   pagados); recaudo queda secundario (el helper de ranking vive en el front y
--   ya usa el resumen; esta RPC expone num_ventas por responsable para alimentarlo).
--
-- Afecta las 4 RPCs: resumen, perfil, kpis_mes, serie_mensual. Idempotente
-- (DROP + CREATE). SECURITY DEFINER + check de pertenencia. Rollback al final.
-- ============================================================


-- ==========================================================================
-- RPC 1: resumen por responsable  (agrega num_ventas por la def de pago)
-- ==========================================================================
DROP FUNCTION IF EXISTS public.get_comercial_resumen_soena(uuid);

CREATE FUNCTION public.get_comercial_resumen_soena(p_workspace_id uuid)
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
  -- fecha_venta + recaudo desglosado por negocio.
  cobros_neg AS (
    SELECT
      c.negocio_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')                 AS fecha_venta,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')                 AS honorario,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                                AS tarifa
    FROM cobros c, guard g
    WHERE c.workspace_id = g.id AND c.fecha IS NOT NULL
    GROUP BY c.negocio_id
  ),
  base AS (
    SELECT
      n.responsable_id,
      n.stage_actual,
      n.estado,
      COALESCE(n.precio_aprobado, 0)      AS precio_aprobado,
      cn.fecha_venta,
      (cn.fecha_venta IS NOT NULL)        AS es_venta,
      COALESCE(cn.honorario, 0)           AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)              AS tarifa_recaudada
    FROM negocios n
    CROSS JOIN guard g
    LEFT JOIN cobros_neg cn ON cn.negocio_id = n.id
    WHERE n.workspace_id = g.id
  ),
  por_resp AS (
    SELECT
      b.responsable_id,
      COUNT(*)                                                      AS negocios_total,
      COUNT(*) FILTER (WHERE b.estado = 'abierto')                 AS negocios_abiertos,
      COUNT(*) FILTER (WHERE b.es_venta)                           AS num_ventas,
      COUNT(*) FILTER (WHERE b.stage_actual = 'venta')             AS en_venta,
      COUNT(*) FILTER (WHERE b.stage_actual = 'ejecucion')         AS en_ejecucion,
      COUNT(*) FILTER (WHERE b.stage_actual = 'cobro')             AS en_cobro,
      COUNT(*) FILTER (WHERE b.stage_actual = 'cerrado'
                          OR b.estado = 'completado')              AS cerrados,
      COALESCE(SUM(b.precio_aprobado), 0)                          AS valor_aprobado,
      COALESCE(SUM(b.honorario_recaudado), 0)                      AS honorario_recaudado,
      COALESCE(SUM(b.tarifa_recaudada), 0)                         AS tarifa_recaudada
    FROM base b
    GROUP BY b.responsable_id
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(x ORDER BY val DESC, nombre)
     FROM (
       SELECT
         jsonb_build_object(
           'responsable_id',       pr.responsable_id,
           'nombre',               COALESCE(s.full_name, '(sin responsable)'),
           'position',             s.position,
           'sin_responsable',      pr.responsable_id IS NULL,
           'negocios_total',       pr.negocios_total,
           'negocios_abiertos',    pr.negocios_abiertos,
           'num_ventas',           pr.num_ventas,
           'en_venta',             pr.en_venta,
           'en_ejecucion',         pr.en_ejecucion,
           'en_cobro',             pr.en_cobro,
           'cerrados',             pr.cerrados,
           'valor_aprobado',       pr.valor_aprobado,
           'honorario_recaudado',  pr.honorario_recaudado,
           'tarifa_recaudada',     pr.tarifa_recaudada
         ) AS x,
         pr.num_ventas AS val,
         COALESCE(s.full_name, '(sin responsable)') AS nombre
       FROM por_resp pr
       LEFT JOIN staff s ON s.id = pr.responsable_id
     ) t),
    '[]'::jsonb
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_comercial_resumen_soena(uuid) IS
  'Resumen comercial por responsable. num_ventas = negocios con >=1 pago de honorario (venta = primer pago, NO propuesta). Ordena por num_ventas. honorario/tarifa desglosado (pasante aparte). SECURITY DEFINER con check de pertenencia.';


-- ==========================================================================
-- RPC 2: perfil de un responsable  (con $ pendiente por stage)
-- ==========================================================================
DROP FUNCTION IF EXISTS public.get_comercial_perfil_soena(uuid);

CREATE FUNCTION public.get_comercial_perfil_soena(p_responsable_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ws AS (SELECT current_user_workspace_id() AS id),
  cobros_neg AS (
    SELECT
      c.negocio_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS honorario,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                AS tarifa
    FROM cobros c, ws
    WHERE c.workspace_id = ws.id AND c.fecha IS NOT NULL
    GROUP BY c.negocio_id
  ),
  base AS (
    SELECT
      n.id,
      n.codigo,
      n.nombre,
      n.stage_actual,
      n.estado,
      e.nombre                        AS etapa_nombre,
      e.numero                        AS etapa_numero,
      COALESCE(n.precio_aprobado, 0)  AS precio_aprobado,
      cn.fecha_venta,
      (cn.fecha_venta IS NOT NULL)    AS es_venta,
      COALESCE(cn.honorario, 0)       AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)          AS tarifa_recaudada,
      -- pendiente de recaudo del honorario (nunca negativo).
      GREATEST(COALESCE(n.precio_aprobado,0) - COALESCE(cn.honorario,0), 0) AS pendiente_honorario
    FROM negocios n
    CROSS JOIN ws
    LEFT JOIN cobros_neg cn    ON cn.negocio_id = n.id
    LEFT JOIN etapas_negocio e ON e.id = n.etapa_actual_id
    WHERE n.workspace_id = ws.id
      AND n.responsable_id IS NOT DISTINCT FROM p_responsable_id
  )
  SELECT jsonb_build_object(
    'responsable_id', p_responsable_id,
    'nombre',         COALESCE((SELECT full_name FROM staff WHERE id = p_responsable_id), '(sin responsable)'),
    'position',       (SELECT position FROM staff WHERE id = p_responsable_id),
    'sin_responsable', p_responsable_id IS NULL,
    'kpis', (
      SELECT jsonb_build_object(
        'negocios_total',      COUNT(*),
        'negocios_abiertos',   COUNT(*) FILTER (WHERE estado = 'abierto'),
        'num_ventas',          COUNT(*) FILTER (WHERE es_venta),
        'valor_aprobado',      COALESCE(SUM(precio_aprobado), 0),
        'honorario_recaudado', COALESCE(SUM(honorario_recaudado), 0),
        'tarifa_recaudada',    COALESCE(SUM(tarifa_recaudada), 0),
        'pendiente_honorario', COALESCE(SUM(pendiente_honorario), 0)
      ) FROM base
    ),
    'porStage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stage',   stage,
        'negocios', cnt,
        'valor_aprobado', val,
        'pendiente_honorario', pend
      ) ORDER BY ord)
      FROM (
        SELECT
          COALESCE(stage_actual, '(sin stage)') AS stage,
          COUNT(*) AS cnt,
          COALESCE(SUM(precio_aprobado), 0) AS val,
          COALESCE(SUM(pendiente_honorario), 0) AS pend,
          MIN(CASE stage_actual
                WHEN 'venta' THEN 1 WHEN 'ejecucion' THEN 2
                WHEN 'cobro' THEN 3 WHEN 'cerrado' THEN 4 ELSE 5 END) AS ord
        FROM base
        GROUP BY stage_actual
      ) s
    ), '[]'::jsonb),
    -- Embudo por etapa/estatus con $ pendiente (mas granular que porStage).
    'porEtapa', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'etapa_numero', etapa_numero,
        'etapa_nombre', COALESCE(etapa_nombre, '(sin etapa)'),
        'stage', stage_actual,
        'negocios', cnt,
        'valor_aprobado', val,
        'pendiente_honorario', pend
      ) ORDER BY etapa_numero NULLS LAST)
      FROM (
        SELECT etapa_numero, etapa_nombre, stage_actual,
          COUNT(*) cnt, COALESCE(SUM(precio_aprobado),0) val,
          COALESCE(SUM(pendiente_honorario),0) pend
        FROM base
        GROUP BY etapa_numero, etapa_nombre, stage_actual
      ) e
    ), '[]'::jsonb),
    'negocios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',                  id,
        'codigo',              codigo,
        'nombre',              nombre,
        'stage',               stage_actual,
        'estado',              estado,
        'etapa_nombre',        etapa_nombre,
        'etapa_numero',        etapa_numero,
        'es_venta',            es_venta,
        'fecha_venta',         fecha_venta,
        'valor_aprobado',      precio_aprobado,
        'honorario_recaudado', honorario_recaudado,
        'tarifa_recaudada',    tarifa_recaudada,
        'pendiente_honorario', pendiente_honorario
      ) ORDER BY precio_aprobado DESC, nombre)
      FROM base
    ), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_comercial_perfil_soena(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comercial_perfil_soena(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comercial_perfil_soena(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_comercial_perfil_soena(uuid) IS
  'Perfil comercial de un responsable. num_ventas = negocios con pago de honorario. Embudo por etapa/stage con $ pendiente de recaudo. SECURITY DEFINER, scope al workspace del llamante.';


-- ==========================================================================
-- RPC 3: KPIs + tabla por vendedor de UN mes  (venta = primer pago)
-- ==========================================================================
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
  -- Honorario aprobado (valor) por negocio desde la propuesta canonica. SOLO monto.
  propuesta AS (
    SELECT DISTINCT ON (nb.negocio_id)
      nb.negocio_id,
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
  -- fecha_venta (primer pago honorario) + recaudo por negocio.
  cobros_neg AS (
    SELECT
      c.negocio_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')  AS fecha_venta,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')  AS honorario_recaudado,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante'
                             AND c.tipo_cobro IS DISTINCT FROM 'saldo')     AS primer_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'saldo')                    AS segundo_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                  AS tarifa
    FROM cobros c, guard g
    WHERE c.workspace_id = g.id AND c.fecha IS NOT NULL
    GROUP BY c.negocio_id
  ),
  -- Ventas del mes = negocios cuyo PRIMER PAGO cae en el mes.
  ventas_mes AS (
    SELECT
      n.id AS negocio_id,
      n.responsable_id,
      cn.fecha_venta,
      COALESCE(p.honorario_con_iva, n.precio_aprobado, 0)                       AS honorario_con_iva,
      COALESCE(p.honorario_con_iva / (1 + p.iva_frac),
               n.precio_aprobado / 1.19, 0)                                     AS honorario_sin_iva,
      COALESCE(cn.honorario_recaudado, 0)                                       AS honorario_recaudado,
      COALESCE(cn.primer_pago, 0)                                               AS primer_pago,
      COALESCE(cn.segundo_pago, 0)                                              AS segundo_pago,
      COALESCE(cn.tarifa, 0)                                                    AS tarifa,
      -- caso completo: recaudo honorario cubre el honorario aprobado (sin IVA), tol 1 peso.
      (COALESCE(cn.honorario_recaudado, 0)
        >= COALESCE(p.honorario_con_iva / (1 + p.iva_frac), n.precio_aprobado / 1.19, 0) - 1) AS caso_completo
    FROM negocios n
    JOIN guard g          ON n.workspace_id = g.id
    JOIN cobros_neg cn    ON cn.negocio_id = n.id AND cn.fecha_venta IS NOT NULL
    LEFT JOIN propuesta p ON p.negocio_id = n.id
    WHERE EXTRACT(YEAR  FROM cn.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes
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
      COUNT(*) FILTER (WHERE caso_completo)                AS casos_completos
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
    -- Ventas por dia del mes (para el grafico "diariamente cuantas ventas llevamos").
    'porDia', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dia', to_char(dia,'YYYY-MM-DD'), 'ventas', ventas_dia) ORDER BY dia)
      FROM por_dia
    ), '[]'::jsonb),
    'porVendedor', COALESCE((
      SELECT jsonb_agg(row ORDER BY nventas DESC, nombre)
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
          'participacion_pct',    CASE WHEN (SELECT num_ventas FROM tot) > 0
                                       THEN round(100.0 * COUNT(*) / (SELECT num_ventas FROM tot), 1)
                                       ELSE NULL END,
          'meta_num_ventas',      (SELECT meta_num_ventas FROM metas_comerciales mc, guard g
                                    WHERE mc.workspace_id=g.id AND mc.staff_id=vm.responsable_id
                                      AND mc.anio=p_anio AND mc.mes=p_mes LIMIT 1),
          'meta_valor',           (SELECT meta_valor FROM metas_comerciales mc, guard g
                                    WHERE mc.workspace_id=g.id AND mc.staff_id=vm.responsable_id
                                      AND mc.anio=p_anio AND mc.mes=p_mes LIMIT 1)
        ) AS row,
        COUNT(*) AS nventas,
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
  'KPIs + tabla por vendedor del mes. VENTA = primer pago de honorario (MIN cobros.fecha no pasante) en el mes. participacion = % de num ventas. Incluye porDia (ventas diarias). Ranking por num_ventas. SECURITY DEFINER con check de pertenencia.';


-- ==========================================================================
-- RPC 4: series historicas por mes  (ventas por mes de primer pago)
-- ==========================================================================
DROP FUNCTION IF EXISTS public.get_comercial_serie_mensual_soena(uuid, integer);

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
  propuesta AS (
    SELECT DISTINCT ON (nb.negocio_id)
      nb.negocio_id,
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
  -- venta por negocio con su fecha (primer pago) + valor de la propuesta.
  ventas AS (
    SELECT
      n.id AS negocio_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      COALESCE(p.honorario_con_iva / (1 + p.iva_frac), n.precio_aprobado / 1.19, 0) AS honorario_sin_iva,
      COALESCE(p.honorario_con_iva, n.precio_aprobado, 0)                           AS honorario_con_iva
    FROM negocios n
    JOIN guard g          ON n.workspace_id = g.id
    JOIN cobros c         ON c.negocio_id = n.id AND c.workspace_id = g.id AND c.fecha IS NOT NULL
    LEFT JOIN propuesta p ON p.negocio_id = n.id
    GROUP BY n.id, n.precio_aprobado, p.honorario_con_iva, p.iva_frac
    HAVING MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') IS NOT NULL
  ),
  ventas_por_mes AS (
    SELECT
      date_trunc('month', fecha_venta) AS mes_ini,
      COUNT(*) AS num_ventas,
      SUM(honorario_sin_iva) AS valor_sin_iva,
      SUM(honorario_con_iva) AS valor_con_iva
    FROM ventas GROUP BY 1
  ),
  -- recaudo por mes del pago (fecha del cobro), desglosado.
  recaudo_por_mes AS (
    SELECT
      date_trunc('month', c.fecha) AS mes_ini,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante')                                   AS honorario_recaudado,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante' AND c.tipo_cobro IS DISTINCT FROM 'saldo') AS primer_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'saldo')                                                    AS segundo_pago,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                                                  AS tarifa
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
  'Series historicas por mes. Ventas por mes = negocios cuyo PRIMER PAGO de honorario cae en el mes. Recaudo por fecha del cobro. SECURITY DEFINER con check de pertenencia.';

-- ============================================================
-- ROLLBACK (comentado): revertir a la migracion 20260721000002 (venta=aprobado_at)
--   re-aplicando esa migracion + 20260720000001. Las firmas de las 4 funciones
--   no cambian, asi que un simple re-CREATE de las versiones previas revierte.
-- ============================================================
