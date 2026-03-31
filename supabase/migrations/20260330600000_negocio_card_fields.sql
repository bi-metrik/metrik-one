-- Extend v_proyecto_financiero with 3 new fields:
-- oportunidad_codigo — linked oportunidad's code (e.g. N-001)
-- responsable_nombre — staff full_name responsible for the project
-- ultima_actividad   — GREATEST(updated_at, last activity_log entry)

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
  o.codigo AS oportunidad_codigo,
  rs.full_name AS responsable_nombre,
  GREATEST(p.updated_at, COALESCE(al.ultima_ts, p.updated_at)) AS ultima_actividad,
  COALESCE(h.total_horas, 0) AS horas_reales,
  COALESCE(h.costo_horas, 0) AS costo_horas,
  COALESCE(g.total_gastos, 0) AS gastos_directos,
  COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0) AS costo_acumulado,
  CASE WHEN p.presupuesto_total > 0 THEN
    ROUND(((COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total) * 100, 1)
  ELSE 0 END AS presupuesto_consumido_pct,
  COALESCE(f.total_facturado, 0) AS facturado,
  COALESCE(f.num_facturas, 0)::INTEGER AS num_facturas,
  COALESCE(c.total_cobrado, 0) AS cobrado,
  COALESCE(c.num_cobros, 0)::INTEGER AS num_cobros,
  COALESCE(c.total_cobrado, 0)
    - (COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0))
  AS ganancia_actual
FROM proyectos p
LEFT JOIN empresas e ON e.id = p.empresa_id
LEFT JOIN contactos ct ON ct.id = p.contacto_id
LEFT JOIN oportunidades o ON o.id = p.oportunidad_id
LEFT JOIN staff rs ON rs.id = p.responsable_id
LEFT JOIN LATERAL (
  SELECT MAX(created_at) AS ultima_ts
  FROM activity_log
  WHERE entidad_id = p.id
) al ON true
LEFT JOIN LATERAL (
  SELECT
    SUM(hr.horas) AS total_horas,
    SUM(hr.horas * COALESCE(s.salary / NULLIF(s.horas_disponibles_mes, 0), 0)) AS costo_horas
  FROM horas hr
  LEFT JOIN staff s ON s.id = hr.staff_id
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
