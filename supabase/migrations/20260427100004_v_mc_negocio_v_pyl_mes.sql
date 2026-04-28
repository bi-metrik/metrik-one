-- ============================================================
-- 20260427100004 — Vistas v_mc_negocio + v_pyl_mes
-- MC auditable por negocio + PyL mensual con EBITDA.
-- Reemplaza margen_contribucion_estimado/calculado/blend de config_financiera.
-- Spec: docs/specs/2026-04-26_mc-ebitda-capa-fiscal-simplificada.md §1
-- Depende de: clasificacion_costo (000001), simplificar_fiscal (000002)
-- ============================================================

-- ── v_mc_negocio ──────────────────────────────────────────
-- MC auditable por negocio: precio_total - sum(gastos variables imputados al negocio)
-- Excluye gastos clasificados como fijo o no_operativo
DROP VIEW IF EXISTS v_mc_negocio;
CREATE VIEW v_mc_negocio AS
SELECT
  n.id                      AS negocio_id,
  n.workspace_id,
  n.codigo                  AS negocio_codigo,
  n.nombre                  AS negocio_nombre,
  n.precio_aprobado,
  n.precio_estimado,
  n.estado,
  n.stage_actual,
  COALESCE(SUM(g.monto), 0) AS costos_variables,
  COALESCE(n.precio_aprobado, n.precio_estimado, 0) - COALESCE(SUM(g.monto), 0) AS mc,
  CASE
    WHEN COALESCE(n.precio_aprobado, n.precio_estimado, 0) > 0
      THEN (COALESCE(n.precio_aprobado, n.precio_estimado, 0) - COALESCE(SUM(g.monto), 0))
        / COALESCE(n.precio_aprobado, n.precio_estimado, 1)::NUMERIC
    ELSE NULL
  END                       AS mc_pct,
  COUNT(g.id)               AS gastos_count
FROM negocios n
LEFT JOIN gastos g
  ON g.negocio_id = n.id
 AND g.clasificacion_costo = 'variable'
GROUP BY n.id, n.workspace_id, n.codigo, n.nombre,
         n.precio_aprobado, n.precio_estimado,
         n.estado, n.stage_actual;

COMMENT ON VIEW v_mc_negocio IS
  'MC auditable por negocio. Costos variables = sum(gastos.monto) WHERE clasificacion_costo=variable AND negocio_id=N. Reemplaza blend 40/60/100 historico.';

-- ── v_pyl_mes ─────────────────────────────────────────────
-- PyL mensual por workspace.
-- Ingresos = sum(cobros) en el mes
-- Costos variables = sum(gastos.clasificacion=variable) en el mes
-- MC = ingresos - variables
-- Fijos = sum(gastos.clasificacion=fijo en el mes) + sum(fixed_expenses.monthly_amount activos) + sum(gastos_fijos_config.monto_referencia activos)
-- EBITDA = MC - fijos
-- Excluye gastos no_operativo
DROP VIEW IF EXISTS v_pyl_mes;
CREATE VIEW v_pyl_mes AS
WITH meses AS (
  SELECT DISTINCT
    workspace_id,
    DATE_TRUNC('month', fecha)::DATE AS mes
  FROM cobros
  UNION
  SELECT DISTINCT
    workspace_id,
    DATE_TRUNC('month', fecha)::DATE AS mes
  FROM gastos
),
ingresos AS (
  SELECT
    workspace_id,
    DATE_TRUNC('month', fecha)::DATE AS mes,
    SUM(monto)::NUMERIC AS ingresos
  FROM cobros
  GROUP BY workspace_id, DATE_TRUNC('month', fecha)
),
variables AS (
  SELECT
    workspace_id,
    DATE_TRUNC('month', fecha)::DATE AS mes,
    SUM(monto)::NUMERIC AS costos_variables
  FROM gastos
  WHERE clasificacion_costo = 'variable'
  GROUP BY workspace_id, DATE_TRUNC('month', fecha)
),
fijos_gastos AS (
  SELECT
    workspace_id,
    DATE_TRUNC('month', fecha)::DATE AS mes,
    SUM(monto)::NUMERIC AS fijos_gastos
  FROM gastos
  WHERE clasificacion_costo = 'fijo'
  GROUP BY workspace_id, DATE_TRUNC('month', fecha)
),
fijos_config AS (
  SELECT
    workspace_id,
    SUM(monthly_amount)::NUMERIC AS fijos_recurrentes
  FROM fixed_expenses
  WHERE is_active = true
  GROUP BY workspace_id
),
fijos_legacy AS (
  SELECT
    workspace_id,
    SUM(monto_referencia)::NUMERIC AS fijos_recurrentes_legacy
  FROM gastos_fijos_config
  WHERE activo = true
  GROUP BY workspace_id
)
SELECT
  m.workspace_id,
  m.mes,
  COALESCE(i.ingresos, 0)                                                      AS ingresos,
  COALESCE(v.costos_variables, 0)                                              AS costos_variables,
  COALESCE(i.ingresos, 0) - COALESCE(v.costos_variables, 0)                    AS mc,
  CASE
    WHEN COALESCE(i.ingresos, 0) > 0
      THEN (COALESCE(i.ingresos, 0) - COALESCE(v.costos_variables, 0)) / i.ingresos
    ELSE NULL
  END                                                                           AS mc_pct,
  COALESCE(fg.fijos_gastos, 0)                                                  AS fijos_gastos_mes,
  COALESCE(fc.fijos_recurrentes, 0) + COALESCE(fl.fijos_recurrentes_legacy, 0) AS fijos_recurrentes,
  COALESCE(fg.fijos_gastos, 0)
    + COALESCE(fc.fijos_recurrentes, 0)
    + COALESCE(fl.fijos_recurrentes_legacy, 0)                                  AS fijos_total,
  (COALESCE(i.ingresos, 0) - COALESCE(v.costos_variables, 0))
    - (COALESCE(fg.fijos_gastos, 0)
       + COALESCE(fc.fijos_recurrentes, 0)
       + COALESCE(fl.fijos_recurrentes_legacy, 0))                              AS ebitda
FROM meses m
LEFT JOIN ingresos     i  ON i.workspace_id = m.workspace_id AND i.mes = m.mes
LEFT JOIN variables    v  ON v.workspace_id = m.workspace_id AND v.mes = m.mes
LEFT JOIN fijos_gastos fg ON fg.workspace_id = m.workspace_id AND fg.mes = m.mes
LEFT JOIN fijos_config fc ON fc.workspace_id = m.workspace_id
LEFT JOIN fijos_legacy fl ON fl.workspace_id = m.workspace_id;

COMMENT ON VIEW v_pyl_mes IS
  'PyL mensual por workspace. MC = ingresos - variables. EBITDA = MC - fijos (gastos clasificacion=fijo + fixed_expenses + gastos_fijos_config). Excluye no_operativo.';
