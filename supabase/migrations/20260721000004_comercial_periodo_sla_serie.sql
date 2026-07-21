-- ============================================================
-- 20260721000004 — Perfil segmentable por periodo + SLA/ultimo avance + serie del vendedor
-- ------------------------------------------------------------
-- Iteracion 5. Solo toca el perfil del vendedor (/equipo) y el ranking. NO toca
-- el agregado de /tableros.
--
-- 1. SELECTOR DE PERIODO en resumen y perfil: params (p_anio, p_mes). NULL =
--    ACUMULADO (global, default). Con anio+mes = solo ese mes. El periodo filtra
--    num_ventas + recaudo (por fecha_venta = primer pago de honorario, def. de
--    venta vigente) para que el RANKING pueda calcularse acumulado o por mes.
--    Resuelve la ambiguedad Jessica 20 (acumulado) vs 10 (julio): ahora es a
--    proposito, con el periodo etiquetado en pantalla.
--    - num_ventas: negocios cuya fecha_venta cae en el periodo (o cualquiera si acum).
--    - honorario_recaudado / tarifa: cobros cuya fecha cae en el periodo (o todos si acum).
--    - valor_aprobado / negocios / embudo por etapa: NO se filtran por periodo (son
--      estado actual del pipeline del vendedor, no un flujo temporal).
--
-- 2. SLA / ULTIMO AVANCE por negocio (perfil): reusa la fuente del producto
--    (v_negocios_etapa_vencimiento): ultimo avance = negocios.etapa_cambiada_at;
--    SLA = etapas_negocio.config_extra->>'sla_horas' (horas habiles);
--    vencido = horas_habiles_entre(etapa_cambiada_at, now()) > sla_horas.
--    sla_estado: 'a_tiempo' | 'vencido' | 'sin_sla'. Solo aplica a negocios abiertos.
--
-- 3. SERIE MENSUAL DEL VENDEDOR (perfil): ventas/mes + recaudo/mes de ESE
--    responsable (ultimos 12 meses), misma def. de venta (primer pago). Para las
--    2 graficas historicas del perfil.
--
-- Idempotente (DROP + CREATE). SECURITY DEFINER + check de pertenencia. Grants
-- endurecidos (revoke PUBLIC/anon, grant authenticated). Rollback al final.
-- ============================================================


-- ==========================================================================
-- RPC 1: resumen por responsable — con periodo (para ranking acum / por mes)
-- ==========================================================================
DROP FUNCTION IF EXISTS public.get_comercial_resumen_soena(uuid);
DROP FUNCTION IF EXISTS public.get_comercial_resumen_soena(uuid, integer, integer);

CREATE FUNCTION public.get_comercial_resumen_soena(
  p_workspace_id uuid,
  p_anio integer DEFAULT NULL,
  p_mes integer DEFAULT NULL
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
  -- fecha_venta (primer pago honorario) + recaudo del PERIODO (o acumulado si null).
  cobros_neg AS (
    SELECT
      c.negocio_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      SUM(c.monto) FILTER (
        WHERE c.tipo_cobro IS DISTINCT FROM 'pasante'
          AND (p_anio IS NULL OR (EXTRACT(YEAR FROM c.fecha) = p_anio AND EXTRACT(MONTH FROM c.fecha) = p_mes))
      ) AS honorario,
      SUM(c.monto) FILTER (
        WHERE c.tipo_cobro = 'pasante'
          AND (p_anio IS NULL OR (EXTRACT(YEAR FROM c.fecha) = p_anio AND EXTRACT(MONTH FROM c.fecha) = p_mes))
      ) AS tarifa
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
      -- es_venta del periodo: fecha_venta dentro del mes (o cualquiera si acumulado).
      (cn.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM cn.fecha_venta) = p_anio AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes)))
                                          AS es_venta_periodo,
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
      COUNT(*) FILTER (WHERE b.es_venta_periodo)                   AS num_ventas,
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

REVOKE EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_comercial_resumen_soena(uuid, integer, integer) IS
  'Resumen comercial por responsable, segmentable por periodo (p_anio,p_mes NULL = acumulado). num_ventas + recaudo del periodo (venta = primer pago). Alimenta el ranking (acum o por mes). SECURITY DEFINER con check de pertenencia.';


-- ==========================================================================
-- RPC 2: perfil de un responsable — periodo + SLA/ultimo avance + serie
-- ==========================================================================
DROP FUNCTION IF EXISTS public.get_comercial_perfil_soena(uuid);
DROP FUNCTION IF EXISTS public.get_comercial_perfil_soena(uuid, integer, integer);

CREATE FUNCTION public.get_comercial_perfil_soena(
  p_responsable_id uuid,
  p_anio integer DEFAULT NULL,
  p_mes integer DEFAULT NULL
)
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
      SUM(c.monto) FILTER (
        WHERE c.tipo_cobro IS DISTINCT FROM 'pasante'
          AND (p_anio IS NULL OR (EXTRACT(YEAR FROM c.fecha) = p_anio AND EXTRACT(MONTH FROM c.fecha) = p_mes))
      ) AS honorario,
      SUM(c.monto) FILTER (
        WHERE c.tipo_cobro = 'pasante'
          AND (p_anio IS NULL OR (EXTRACT(YEAR FROM c.fecha) = p_anio AND EXTRACT(MONTH FROM c.fecha) = p_mes))
      ) AS tarifa
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
      n.etapa_cambiada_at,
      e.nombre                        AS etapa_nombre,
      e.numero                        AS etapa_numero,
      (e.config_extra->>'sla_horas')::integer AS sla_horas,
      COALESCE(n.precio_aprobado, 0)  AS precio_aprobado,
      cn.fecha_venta,
      (cn.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM cn.fecha_venta) = p_anio AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes)))
                                      AS es_venta_periodo,
      COALESCE(cn.honorario, 0)       AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)          AS tarifa_recaudada,
      GREATEST(COALESCE(n.precio_aprobado,0) - COALESCE(cn.honorario,0), 0) AS pendiente_honorario,
      -- SLA: solo abiertos con sla_horas configurado. a_tiempo / vencido / sin_sla.
      CASE
        WHEN n.estado <> 'abierto' THEN 'sin_sla'
        WHEN (e.config_extra->>'sla_horas') IS NULL THEN 'sin_sla'
        WHEN horas_habiles_entre(n.etapa_cambiada_at, now()) > (e.config_extra->>'sla_horas')::numeric THEN 'vencido'
        ELSE 'a_tiempo'
      END AS sla_estado
    FROM negocios n
    CROSS JOIN ws
    LEFT JOIN cobros_neg cn    ON cn.negocio_id = n.id
    LEFT JOIN etapas_negocio e ON e.id = n.etapa_actual_id
    WHERE n.workspace_id = ws.id
      AND n.responsable_id IS NOT DISTINCT FROM p_responsable_id
  ),
  -- Serie mensual del vendedor: ventas/mes + recaudo/mes (ultimos 12 meses).
  meses AS (
    SELECT date_trunc('month', CURRENT_DATE) - (n || ' month')::interval AS mes_ini
    FROM generate_series(0, 11) n
  ),
  ventas_mes AS (
    SELECT date_trunc('month', fecha_venta) AS mes_ini, COUNT(*) AS num_ventas,
           COALESCE(SUM(precio_aprobado),0) AS valor
    FROM base WHERE fecha_venta IS NOT NULL
    GROUP BY 1
  ),
  recaudo_mes AS (
    SELECT date_trunc('month', c.fecha) AS mes_ini,
           SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS honorario
    FROM cobros c
    CROSS JOIN ws
    JOIN negocios n ON n.id = c.negocio_id
    WHERE c.workspace_id = ws.id AND c.fecha IS NOT NULL
      AND n.responsable_id IS NOT DISTINCT FROM p_responsable_id
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'responsable_id', p_responsable_id,
    'nombre',         COALESCE((SELECT full_name FROM staff WHERE id = p_responsable_id), '(sin responsable)'),
    'position',       (SELECT position FROM staff WHERE id = p_responsable_id),
    'sin_responsable', p_responsable_id IS NULL,
    'anio', p_anio,
    'mes', p_mes,
    'kpis', (
      SELECT jsonb_build_object(
        'negocios_total',      COUNT(*),
        'negocios_abiertos',   COUNT(*) FILTER (WHERE estado = 'abierto'),
        'num_ventas',          COUNT(*) FILTER (WHERE es_venta_periodo),
        'valor_aprobado',      COALESCE(SUM(precio_aprobado), 0),
        'honorario_recaudado', COALESCE(SUM(honorario_recaudado), 0),
        'tarifa_recaudada',    COALESCE(SUM(tarifa_recaudada), 0),
        'pendiente_honorario', COALESCE(SUM(pendiente_honorario), 0),
        'vencidos',            COUNT(*) FILTER (WHERE sla_estado = 'vencido')
      ) FROM base
    ),
    'porStage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stage', stage, 'negocios', cnt, 'valor_aprobado', val, 'pendiente_honorario', pend
      ) ORDER BY ord)
      FROM (
        SELECT COALESCE(stage_actual, '(sin stage)') AS stage, COUNT(*) AS cnt,
          COALESCE(SUM(precio_aprobado), 0) AS val, COALESCE(SUM(pendiente_honorario), 0) AS pend,
          MIN(CASE stage_actual WHEN 'venta' THEN 1 WHEN 'ejecucion' THEN 2
                WHEN 'cobro' THEN 3 WHEN 'cerrado' THEN 4 ELSE 5 END) AS ord
        FROM base GROUP BY stage_actual
      ) s
    ), '[]'::jsonb),
    'porEtapa', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'etapa_numero', etapa_numero, 'etapa_nombre', COALESCE(etapa_nombre, '(sin etapa)'),
        'stage', stage_actual, 'negocios', cnt, 'valor_aprobado', val, 'pendiente_honorario', pend
      ) ORDER BY etapa_numero NULLS LAST)
      FROM (
        SELECT etapa_numero, etapa_nombre, stage_actual, COUNT(*) cnt,
          COALESCE(SUM(precio_aprobado),0) val, COALESCE(SUM(pendiente_honorario),0) pend
        FROM base GROUP BY etapa_numero, etapa_nombre, stage_actual
      ) e
    ), '[]'::jsonb),
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio', EXTRACT(YEAR FROM m.mes_ini)::int,
        'mes', EXTRACT(MONTH FROM m.mes_ini)::int,
        'label', to_char(m.mes_ini, 'Mon YY'),
        'num_ventas', COALESCE(vm.num_ventas, 0),
        'valor_aprobado', COALESCE(vm.valor, 0),
        'honorario_recaudado', COALESCE(rm.honorario, 0)
      ) ORDER BY m.mes_ini)
      FROM meses m
      LEFT JOIN ventas_mes vm ON vm.mes_ini = m.mes_ini
      LEFT JOIN recaudo_mes rm ON rm.mes_ini = m.mes_ini
    ), '[]'::jsonb),
    'negocios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'codigo', codigo, 'nombre', nombre, 'stage', stage_actual, 'estado', estado,
        'etapa_nombre', etapa_nombre, 'etapa_numero', etapa_numero,
        'es_venta', es_venta_periodo, 'fecha_venta', fecha_venta,
        'ultimo_avance', etapa_cambiada_at, 'sla_horas', sla_horas, 'sla_estado', sla_estado,
        'valor_aprobado', precio_aprobado, 'honorario_recaudado', honorario_recaudado,
        'tarifa_recaudada', tarifa_recaudada, 'pendiente_honorario', pendiente_honorario
      ) ORDER BY precio_aprobado DESC, nombre)
      FROM base
    ), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_comercial_perfil_soena(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comercial_perfil_soena(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comercial_perfil_soena(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_comercial_perfil_soena(uuid, integer, integer) IS
  'Perfil comercial de un responsable, segmentable por periodo (p_anio,p_mes NULL = acumulado). num_ventas + recaudo del periodo (venta = primer pago). Negocios con ultimo_avance (etapa_cambiada_at) + sla_estado (a_tiempo/vencido/sin_sla via horas_habiles_entre). serie[] mensual del vendedor (12m). SECURITY DEFINER con check de pertenencia.';

-- ============================================================
-- ROLLBACK (comentado): re-aplicar 20260721000003 (firmas sin periodo).
--   DROP FUNCTION IF EXISTS public.get_comercial_resumen_soena(uuid, integer, integer);
--   DROP FUNCTION IF EXISTS public.get_comercial_perfil_soena(uuid, integer, integer);
--   -- luego recrear las versiones (uuid) y (uuid) de 20260721000003.
-- ============================================================
