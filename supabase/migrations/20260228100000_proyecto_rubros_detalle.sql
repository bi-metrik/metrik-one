-- Add cantidad, unidad, valor_unitario to proyecto_rubros
-- Matches the pattern used in cotización rubros (cantidad × valor_unitario = presupuestado)

ALTER TABLE proyecto_rubros ADD COLUMN IF NOT EXISTS cantidad NUMERIC(12,2);
ALTER TABLE proyecto_rubros ADD COLUMN IF NOT EXISTS unidad TEXT;
ALTER TABLE proyecto_rubros ADD COLUMN IF NOT EXISTS valor_unitario NUMERIC(15,2);

-- Update the comparativo view to include new columns
DROP VIEW IF EXISTS v_proyecto_rubros_comparativo;
CREATE VIEW v_proyecto_rubros_comparativo AS
SELECT
  pr.id AS rubro_id,
  pr.proyecto_id,
  pr.nombre AS rubro_nombre,
  pr.tipo AS rubro_tipo,
  pr.cantidad,
  pr.unidad,
  pr.valor_unitario,
  pr.presupuestado,
  COALESCE(SUM(g.monto), 0) AS gastado_real,
  pr.presupuestado - COALESCE(SUM(g.monto), 0) AS diferencia,
  CASE WHEN pr.presupuestado > 0 THEN
    ROUND((COALESCE(SUM(g.monto), 0) / pr.presupuestado) * 100, 1)
  ELSE 0 END AS consumido_pct
FROM proyecto_rubros pr
LEFT JOIN gastos g ON g.rubro_id = pr.id
GROUP BY pr.id, pr.proyecto_id, pr.nombre, pr.tipo, pr.cantidad, pr.unidad, pr.valor_unitario, pr.presupuestado;
