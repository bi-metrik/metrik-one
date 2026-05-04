-- ============================================================
-- 20260504100003 — Vista v_mc_linea_mes
-- Decision Carmen + Mauricio 2026-05-04: MC global + MC por linea con
-- bucket "Sin linea" visible para costos variables no imputados.
-- Habilita drill-down "MC por linea" en /numeros sin romper MC global.
-- ============================================================

DROP VIEW IF EXISTS v_mc_linea_mes;

CREATE VIEW v_mc_linea_mes AS
WITH ingresos_linea AS (
  SELECT
    c.workspace_id,
    DATE_TRUNC('month', c.fecha)::DATE AS mes,
    n.linea_id,
    SUM(c.monto)::NUMERIC AS ingresos
  FROM cobros c
  LEFT JOIN negocios n ON n.id = c.negocio_id
  WHERE c.fecha IS NOT NULL
  GROUP BY c.workspace_id, DATE_TRUNC('month', c.fecha), n.linea_id
),
variables_linea AS (
  SELECT
    g.workspace_id,
    DATE_TRUNC('month', g.fecha)::DATE AS mes,
    n.linea_id,
    SUM(g.monto)::NUMERIC AS costos_variables
  FROM gastos g
  LEFT JOIN negocios n ON n.id = g.negocio_id
  WHERE g.clasificacion_costo = 'variable'
  GROUP BY g.workspace_id, DATE_TRUNC('month', g.fecha), n.linea_id
)
SELECT
  COALESCE(i.workspace_id, v.workspace_id)                                             AS workspace_id,
  COALESCE(i.mes, v.mes)                                                                AS mes,
  COALESCE(i.linea_id, v.linea_id)                                                      AS linea_id,
  l.nombre                                                                              AS linea_nombre,
  l.tipo                                                                                AS linea_tipo,
  COALESCE(i.ingresos, 0)                                                               AS ingresos,
  COALESCE(v.costos_variables, 0)                                                       AS costos_variables,
  COALESCE(i.ingresos, 0) - COALESCE(v.costos_variables, 0)                             AS mc,
  CASE
    WHEN COALESCE(i.ingresos, 0) > 0
      THEN (COALESCE(i.ingresos, 0) - COALESCE(v.costos_variables, 0)) / i.ingresos
    ELSE NULL
  END                                                                                    AS mc_pct
FROM ingresos_linea i
FULL OUTER JOIN variables_linea v
  ON v.workspace_id = i.workspace_id
 AND v.mes = i.mes
 AND v.linea_id IS NOT DISTINCT FROM i.linea_id
LEFT JOIN lineas_negocio l ON l.id = COALESCE(i.linea_id, v.linea_id);

COMMENT ON VIEW v_mc_linea_mes IS
  'MC mensual por linea de negocio. linea_id NULL = bucket "Sin linea" (costos variables sin negocio asignado o cobros huerfanos). Ingresos = cobros confirmados con fecha. Variables = gastos clasificacion_costo=variable. Excluye fijo y no_operativo.';
