-- ============================================================
-- 20260708000011 — v_pyl_mes excluye cobros 'pasante' del ingreso
-- ------------------------------------------------------------
-- P3 Ola 1 (SOENA). La tarifa UPME entra como cobro tipo 'pasante'
-- (migración 20260708000010): recaudo a favor de terceros, NO ingreso.
--
-- Único cambio: el subquery `ingresos` agrega `WHERE tipo_cobro IS DISTINCT
-- FROM 'pasante'`. Como MC = ingresos − variables y EBITDA = MC − fijos, la
-- exclusión se propaga a MC y EBITDA SOLO por la vía del ingreso (variables y
-- fijos vienen de `gastos`, intactos). El saldo del negocio se calcula aparte
-- (SUM(cobros.monto) sin filtro de tipo) y por diseño SÍ incluye el pasante.
--
-- `IS DISTINCT FROM` es null-safe: cobros con tipo_cobro NULL (legacy) siguen
-- contando como ingreso, igual que antes.
--
-- Backward-compatible: ningún cobro tiene tipo 'pasante' aún → los números de
-- todos los workspaces quedan idénticos hoy.
--
-- DROP + CREATE (no CREATE OR REPLACE) por convención. Se re-aplica
-- security_invoker=on + revoke anon para no regresar el hardening del
-- 2026-06-02 (migración 20260602000004).
-- ============================================================

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
  WHERE tipo_cobro IS DISTINCT FROM 'pasante'  -- recaudo a favor de terceros, no ingreso
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
  'PyL mensual por workspace. Ingresos = SUM(cobros) EXCLUYE tipo_cobro=pasante (recaudo a favor de terceros). MC = ingresos - variables. EBITDA = MC - fijos. Excluye no_operativo.';

-- Re-aplicar el hardening 2026-06-02 (DROP borra los settings/grants previos).
ALTER VIEW v_pyl_mes SET (security_invoker = on);
REVOKE SELECT ON v_pyl_mes FROM anon;
