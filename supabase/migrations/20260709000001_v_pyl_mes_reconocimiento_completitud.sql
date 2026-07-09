-- ============================================================
-- 20260709000001 — v_pyl_mes: reconocimiento de ingreso POR COMPLETITUD
--                   (opt-in por workspace, PROSPECTIVO)
-- ------------------------------------------------------------
-- P3 Ola 3 (SOENA). Regla de Mauricio: un ingreso solo es VENTA efectiva
-- cuando el negocio se COMPLETA. El dinero anticipado queda "recaudado, no
-- reconocido"; se cuenta como venta al cierre del negocio.
--
-- Hoy ONE reconoce el ingreso por CAJA: SUM(cobros.monto) por cobros.fecha
-- (excluyendo 'pasante', Ola 1). Esta migración cambia esa base a COMPLETITUD,
-- pero SOLO para workspaces opt-in y SOLO prospectivamente. El resto sigue
-- 100% igual (caja).
--
-- ── MECANISMO (por qué en la VISTA y no en la capa app) ──────────────────
-- El ingreso alimenta MC (= ingreso − variables) y EBITDA (= MC − fijos), todo
-- dentro de v_pyl_mes. El requisito exige que MC/EBITDA también pasen a base
-- completitud para el opt-in. Si se ramificara solo en numeros/actions-v2.ts,
-- el recaudo del tile cambiaría pero MC/EBITDA (que leen la vista) quedarían en
-- caja → inconsistente. Ramificar en la vista mantiene ingreso→MC→EBITDA
-- coherente por construcción, y es una sola fuente de verdad.
-- La CAJA (tesorería/recaudo) NO se esconde: sigue viva como `recaudo_caja`
-- (columna nueva de la vista) y como `recaudoMes` en numeros/actions-v2.ts
-- (que lee cobros directo, sin tocar). Lo que cambia es qué se cuenta como
-- VENTA/ingreso reconocido.
--
-- ── OPT-IN ───────────────────────────────────────────────────────────────
-- Flag: workspaces.modules->>'reconocimiento_completitud' = 'true'
-- (como conciliacion / fab_registrar_pago). La vista hace JOIN a workspaces y
-- ramifica por-fila: si el ws NO tiene el flag → base caja idéntica a hoy.
--
-- ── PROSPECTIVO (cutover, no reescribe el pasado) ────────────────────────
-- Una vista recomputa desde cero: cambiar la base reescribiría meses ya
-- reconocidos de SOENA. Para evitarlo hay una FECHA DE CORTE por workspace:
--   workspaces.config_extra->>'reconocimiento_completitud_cutover' = 'YYYY-MM-DD'
-- La base completitud aplica SOLO a negocios con created_at >= cutover.
-- Los negocios creados ANTES del cutover conservan base caja (sus cobros ya
-- reconocidos no se tocan). Si el flag está activo pero NO hay cutover, la vista
-- cae a caja (fail-safe: nunca reescribe históricos por accidente).
--   → La FECHA DE CORTE es DECISIÓN DE MAURICIO. No se inventa aquí.
--
-- ── DEFINICIÓN DEL INGRESO RECONOCIDO (workspace opt-in con cutover c) ────
-- Para el mes m, ingreso reconocido = suma de tres bolsas:
--   (A) Cobros de negocios LEGACY (created_at < c): base CAJA por cobros.fecha
--       en m, excluyendo pasante. (No se reescribe lo ya reconocido.)
--   (B) Cobros SIN negocio (negocio_id IS NULL): base CAJA por cobros.fecha en
--       m, excluyendo pasante. (No hay completitud a la cual anclar.)
--   (C) Negocios POST-cutover (created_at >= c) que están COMPLETADOS: su
--       HONORARIO (= SUM cobros no-pasante del negocio) reconocido en el mes de
--       su cierre (closed_at). Negocios post-cutover NO completados: 0 (su
--       dinero es "recaudado, no reconocido").
-- Como el gate saldo_cero (Ola 2) obliga pago completo del honorario antes de
-- cerrar, al completarse el honorario está íntegro → (C) captura el 100%.
--
-- Completitud del negocio = negocios.estado='completado' + negocios.closed_at
-- (sello de completarNegocio en negocio-v2-actions.ts). No existe
-- negocios.completado_at; closed_at es el timestamp de cierre.
--
-- ── BACKWARD-COMPATIBLE ──────────────────────────────────────────────────
-- Ningún workspace tiene el flag hoy → la rama caja es idéntica a la vista
-- 20260708000011 (pasante ya excluido). CERO cambio de números para AFI, ALMA,
-- DIMPRO, HJBC, metrik, etc. Verificable: sin flag, ingresos = caja de siempre.
--
-- ── HARDENING ────────────────────────────────────────────────────────────
-- DROP + CREATE (no CREATE OR REPLACE, se agrega columna recaudo_caja).
-- Re-aplica security_invoker=on + revoke anon (patrón 20260602000004).
-- ============================================================

DROP VIEW IF EXISTS v_pyl_mes;
CREATE VIEW v_pyl_mes AS
WITH
ws_reconoc AS (
  SELECT
    w.id AS workspace_id,
    CASE
      WHEN COALESCE(w.modules->>'reconocimiento_completitud', 'false') = 'true'
       AND (w.config_extra->>'reconocimiento_completitud_cutover') IS NOT NULL
       AND (w.config_extra->>'reconocimiento_completitud_cutover') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN true ELSE false
    END AS opt_in,
    CASE
      WHEN (w.config_extra->>'reconocimiento_completitud_cutover') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (w.config_extra->>'reconocimiento_completitud_cutover')::date
      ELSE NULL
    END AS cutover
  FROM workspaces w
),
meses AS (
  SELECT DISTINCT workspace_id, DATE_TRUNC('month', fecha)::DATE AS mes
  FROM cobros
  UNION
  SELECT DISTINCT workspace_id, DATE_TRUNC('month', fecha)::DATE AS mes
  FROM gastos
),
recaudo_caja AS (
  SELECT
    workspace_id,
    DATE_TRUNC('month', fecha)::DATE AS mes,
    SUM(monto)::NUMERIC AS recaudo
  FROM cobros
  WHERE tipo_cobro IS DISTINCT FROM 'pasante'
  GROUP BY workspace_id, DATE_TRUNC('month', fecha)
),
ingresos_caja AS (
  SELECT
    workspace_id,
    DATE_TRUNC('month', fecha)::DATE AS mes,
    SUM(monto)::NUMERIC AS ingresos
  FROM cobros
  WHERE tipo_cobro IS DISTINCT FROM 'pasante'
  GROUP BY workspace_id, DATE_TRUNC('month', fecha)
),
ingresos_comp_caja AS (
  SELECT
    c.workspace_id,
    DATE_TRUNC('month', c.fecha)::DATE AS mes,
    SUM(c.monto)::NUMERIC AS ingresos
  FROM cobros c
  JOIN ws_reconoc r ON r.workspace_id = c.workspace_id AND r.opt_in
  LEFT JOIN negocios n ON n.id = c.negocio_id
  WHERE c.tipo_cobro IS DISTINCT FROM 'pasante'
    AND (
      c.negocio_id IS NULL
      OR n.created_at < r.cutover
    )
  GROUP BY c.workspace_id, DATE_TRUNC('month', c.fecha)
),
ingresos_comp_completados AS (
  SELECT
    n.workspace_id,
    DATE_TRUNC('month', n.closed_at)::DATE AS mes,
    SUM(c.monto)::NUMERIC AS ingresos
  FROM negocios n
  JOIN ws_reconoc r ON r.workspace_id = n.workspace_id AND r.opt_in
  JOIN cobros c ON c.negocio_id = n.id AND c.tipo_cobro IS DISTINCT FROM 'pasante'
  WHERE n.created_at >= r.cutover
    AND n.estado = 'completado'
    AND n.closed_at IS NOT NULL
  GROUP BY n.workspace_id, DATE_TRUNC('month', n.closed_at)
),
ingresos_completitud AS (
  SELECT workspace_id, mes, SUM(ingresos)::NUMERIC AS ingresos
  FROM (
    SELECT workspace_id, mes, ingresos FROM ingresos_comp_caja
    UNION ALL
    SELECT workspace_id, mes, ingresos FROM ingresos_comp_completados
  ) u
  GROUP BY workspace_id, mes
),
ingresos AS (
  SELECT
    m.workspace_id,
    m.mes,
    CASE
      WHEN r.opt_in THEN COALESCE(ic.ingresos, 0)
      ELSE COALESCE(ik.ingresos, 0)
    END AS ingresos
  FROM meses m
  LEFT JOIN ws_reconoc r            ON r.workspace_id = m.workspace_id
  LEFT JOIN ingresos_caja ik        ON ik.workspace_id = m.workspace_id AND ik.mes = m.mes
  LEFT JOIN ingresos_completitud ic ON ic.workspace_id = m.workspace_id AND ic.mes = m.mes
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
  COALESCE(rc.recaudo, 0)                                                       AS recaudo_caja,
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
LEFT JOIN recaudo_caja rc ON rc.workspace_id = m.workspace_id AND rc.mes = m.mes
LEFT JOIN variables    v  ON v.workspace_id = m.workspace_id AND v.mes = m.mes
LEFT JOIN fijos_gastos fg ON fg.workspace_id = m.workspace_id AND fg.mes = m.mes
LEFT JOIN fijos_config fc ON fc.workspace_id = m.workspace_id
LEFT JOIN fijos_legacy fl ON fl.workspace_id = m.workspace_id;

COMMENT ON VIEW v_pyl_mes IS
  'PyL mensual por workspace. Ingresos = base CAJA (SUM cobros no-pasante por fecha) '
  'por defecto; base COMPLETITUD (honorario reconocido al closed_at del negocio) '
  'para workspaces con modules.reconocimiento_completitud=true + '
  'config_extra.reconocimiento_completitud_cutover (prospectivo desde esa fecha). '
  'recaudo_caja = tesorería (siempre caja). MC = ingresos - variables. EBITDA = MC - fijos.';

ALTER VIEW v_pyl_mes SET (security_invoker = on);
REVOKE SELECT ON v_pyl_mes FROM anon;
