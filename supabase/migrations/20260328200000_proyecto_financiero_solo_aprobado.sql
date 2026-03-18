-- CAUSADO es contable, no operativo. Solo APROBADO cuenta para el proyecto.

-- Actualizar v_proyecto_rubros_comparativo para solo contar gastos APROBADO
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
  CASE
    WHEN pr.tipo IN ('mo_propia', 'mo_terceros') THEN COALESCE(hc.costo_horas, 0)
    ELSE COALESCE(g.total_gastos, 0)
  END AS gastado_real,
  pr.presupuestado - CASE
    WHEN pr.tipo IN ('mo_propia', 'mo_terceros') THEN COALESCE(hc.costo_horas, 0)
    ELSE COALESCE(g.total_gastos, 0)
  END AS diferencia,
  CASE WHEN pr.presupuestado > 0 THEN
    ROUND((CASE
      WHEN pr.tipo IN ('mo_propia', 'mo_terceros') THEN COALESCE(hc.costo_horas, 0)
      ELSE COALESCE(g.total_gastos, 0)
    END / pr.presupuestado) * 100, 1)
  ELSE 0 END AS consumido_pct
FROM proyecto_rubros pr

LEFT JOIN LATERAL (
  SELECT SUM(gs.monto) AS total_gastos
  FROM gastos gs
  WHERE gs.rubro_id = pr.id
    AND gs.estado_causacion = 'APROBADO'
) g ON true

LEFT JOIN LATERAL (
  SELECT SUM(h.horas) * COALESCE(
    (SELECT s.salary / NULLIF(s.horas_disponibles_mes, 0)
     FROM staff s
     WHERE s.workspace_id = (SELECT p.workspace_id FROM proyectos p WHERE p.id = pr.proyecto_id)
       AND s.es_principal = true AND s.is_active = true
     LIMIT 1),
    0
  ) AS costo_horas
  FROM horas h
  WHERE h.proyecto_id = pr.proyecto_id
) hc ON true

GROUP BY pr.id, pr.proyecto_id, pr.nombre, pr.tipo, pr.cantidad, pr.unidad, pr.valor_unitario, pr.presupuestado, g.total_gastos, hc.costo_horas;

ALTER VIEW public.v_proyecto_rubros_comparativo SET (security_invoker = true);

-- Actualizar v_proyecto_financiero: solo APROBADO (no CAUSADO)
DROP VIEW IF EXISTS v_proyecto_financiero;
CREATE VIEW v_proyecto_financiero AS
SELECT
  p.id AS proyecto_id,
  p.workspace_id,
  p.codigo,
  p.nombre,
  p.estado,
  p.tipo,
  p.presupuesto_total,
  p.horas_estimadas,
  p.avance_porcentaje,
  p.ganancia_estimada,
  p.retenciones_estimadas,
  p.carpeta_url,
  p.fecha_inicio,
  p.fecha_fin_estimada,
  p.fecha_cierre,
  p.oportunidad_id,
  p.cotizacion_id,
  p.canal_creacion,
  p.created_at,
  p.updated_at,
  e.nombre AS empresa_nombre,
  ct.nombre AS contacto_nombre,
  COALESCE(h.total_horas, 0) AS horas_reales,
  COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0) AS costo_horas,
  COALESCE(g.total_gastos, 0) AS gastos_directos,
  (COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0) AS costo_acumulado,
  CASE WHEN p.presupuesto_total > 0 THEN
    ROUND((((COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total) * 100, 1)
  ELSE 0 END AS presupuesto_consumido_pct,
  COALESCE(f.total_facturado, 0) AS facturado,
  COALESCE(f.num_facturas, 0)::INTEGER AS num_facturas,
  COALESCE(c.total_cobrado, 0) AS cobrado,
  COALESCE(c.num_cobros, 0)::INTEGER AS num_cobros,
  COALESCE(c.total_cobrado, 0)
    - ((COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0))
  AS ganancia_actual
FROM proyectos p
LEFT JOIN empresas e ON e.id = p.empresa_id
LEFT JOIN contactos ct ON ct.id = p.contacto_id
LEFT JOIN LATERAL (
  SELECT (s.salary / NULLIF(s.horas_disponibles_mes, 0)) AS costo_hora_calc
  FROM staff s
  WHERE s.workspace_id = p.workspace_id AND s.es_principal = true AND s.is_active = true
  LIMIT 1
) per ON true
LEFT JOIN LATERAL (
  SELECT SUM(hr.horas) AS total_horas
  FROM horas hr
  WHERE hr.proyecto_id = p.id
) h ON true
LEFT JOIN LATERAL (
  SELECT SUM(gs.monto) AS total_gastos
  FROM gastos gs
  WHERE gs.proyecto_id = p.id
    AND gs.estado_causacion = 'APROBADO'
) g ON true
LEFT JOIN LATERAL (
  SELECT SUM(fa.monto) AS total_facturado, COUNT(*) AS num_facturas
  FROM facturas fa
  WHERE fa.proyecto_id = p.id
) f ON true
LEFT JOIN LATERAL (
  SELECT SUM(cb.monto) AS total_cobrado, COUNT(*) AS num_cobros
  FROM cobros cb
  WHERE cb.proyecto_id = p.id
) c ON true;

ALTER VIEW public.v_proyecto_financiero SET (security_invoker = true);
