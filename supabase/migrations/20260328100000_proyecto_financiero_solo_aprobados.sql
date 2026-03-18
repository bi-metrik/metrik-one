-- Solo contar gastos APROBADOS y CAUSADOS en el financiero del proyecto.
-- PENDIENTE y RECHAZADO no se asignan al proyecto.

-- Necesitamos recrear todas las vistas que dependen de v_proyecto_financiero
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

  -- Empresa y contacto
  e.nombre AS empresa_nombre,
  ct.nombre AS contacto_nombre,

  -- Horas reales
  COALESCE(h.total_horas, 0) AS horas_reales,

  -- Costo por horas
  COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0) AS costo_horas,

  -- Gastos directos (solo APROBADOS y CAUSADOS)
  COALESCE(g.total_gastos, 0) AS gastos_directos,

  -- Costo acumulado total
  (COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0) AS costo_acumulado,

  -- Presupuesto consumido %
  CASE WHEN p.presupuesto_total > 0 THEN
    ROUND((((COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total) * 100, 1)
  ELSE 0 END AS presupuesto_consumido_pct,

  -- Facturado
  COALESCE(f.total_facturado, 0) AS facturado,
  COALESCE(f.num_facturas, 0)::INTEGER AS num_facturas,

  -- Cobrado
  COALESCE(c.total_cobrado, 0) AS cobrado,
  COALESCE(c.num_cobros, 0)::INTEGER AS num_cobros,

  -- Ganancia actual
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
    AND gs.estado_causacion IN ('APROBADO', 'CAUSADO')
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
