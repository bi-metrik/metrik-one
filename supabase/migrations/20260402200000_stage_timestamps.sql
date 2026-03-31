-- Agrega timestamps de cambio de etapa/estado para calcular "días en esta etapa"

-- oportunidades: etapa_changed_at
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS etapa_changed_at TIMESTAMPTZ;
UPDATE oportunidades SET etapa_changed_at = COALESCE(ultima_accion_fecha, updated_at, created_at)
  WHERE etapa_changed_at IS NULL;
ALTER TABLE oportunidades ALTER COLUMN etapa_changed_at SET DEFAULT NOW();
ALTER TABLE oportunidades ALTER COLUMN etapa_changed_at SET NOT NULL;

-- proyectos: estado_changed_at
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS estado_changed_at TIMESTAMPTZ;
UPDATE proyectos SET estado_changed_at = COALESCE(updated_at, created_at)
  WHERE estado_changed_at IS NULL;
ALTER TABLE proyectos ALTER COLUMN estado_changed_at SET DEFAULT NOW();
ALTER TABLE proyectos ALTER COLUMN estado_changed_at SET NOT NULL;

-- Recrear v_proyecto_financiero con estado_changed_at
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
  p.fecha_entrega_estimada,
  p.fecha_cierre,
  p.oportunidad_id,
  p.cotizacion_id,
  p.canal_creacion,
  p.created_at,
  p.updated_at,
  p.estado_changed_at,
  e.nombre AS empresa_nombre,
  ct.nombre AS contacto_nombre,
  o.codigo AS oportunidad_codigo,
  rs.full_name AS responsable_nombre,
  GREATEST(p.updated_at, COALESCE(al.ultima_ts, p.updated_at)) AS ultima_actividad,
  -- Costos
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
  AS ganancia_actual,
  -- D170: Avance calculado adaptativo
  CASE
    WHEN p.estado IN ('cerrado', 'entregado') THEN
      CASE WHEN p.estado = 'cerrado' THEN 100.0 ELSE
        LEAST(100.0, GREATEST(0.0,
          CASE
            WHEN p.horas_estimadas > 0 AND p.presupuesto_total > 0 AND f.total_facturado > 0 THEN
              ROUND(
                (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 40.0) +
                (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 30.0) +
                (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / f.total_facturado * 30.0),
                1
              )
            WHEN p.horas_estimadas IS NULL OR p.horas_estimadas = 0 THEN
              CASE
                WHEN p.presupuesto_total > 0 AND f.total_facturado > 0 THEN
                  ROUND(
                    (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 50.0) +
                    (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / f.total_facturado * 50.0),
                    1
                  )
                WHEN p.presupuesto_total > 0 THEN
                  ROUND(LEAST((COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total, 1.0) * 100.0, 1)
                ELSE 0.0
              END
            WHEN f.total_facturado IS NULL OR f.total_facturado = 0 THEN
              CASE
                WHEN p.horas_estimadas > 0 AND p.presupuesto_total > 0 THEN
                  ROUND(
                    (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 57.14) +
                    (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 42.86),
                    1
                  )
                WHEN p.horas_estimadas > 0 THEN
                  ROUND(LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 100.0, 1)
                ELSE 0.0
              END
            WHEN p.presupuesto_total IS NULL OR p.presupuesto_total = 0 THEN
              CASE
                WHEN p.horas_estimadas > 0 AND f.total_facturado > 0 THEN
                  ROUND(
                    (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 57.14) +
                    (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / f.total_facturado * 42.86),
                    1
                  )
                WHEN p.horas_estimadas > 0 THEN
                  ROUND(LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 100.0, 1)
                ELSE 0.0
              END
            ELSE 0.0
          END
        ))
      END
    ELSE
      LEAST(100.0, GREATEST(0.0,
        CASE
          WHEN p.horas_estimadas > 0 AND p.presupuesto_total > 0 AND COALESCE(f.total_facturado, 0) > 0 THEN
            ROUND(
              (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 40.0) +
              (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 30.0) +
              (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / COALESCE(f.total_facturado, 1) * 30.0),
              1
            )
          WHEN (p.horas_estimadas IS NULL OR p.horas_estimadas = 0) AND p.presupuesto_total > 0 AND COALESCE(f.total_facturado, 0) > 0 THEN
            ROUND(
              (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 50.0) +
              (LEAST(COALESCE(c.total_cobrado, 0), COALESCE(f.total_facturado, 0)) / COALESCE(f.total_facturado, 1) * 50.0),
              1
            )
          WHEN (p.horas_estimadas IS NULL OR p.horas_estimadas = 0) AND p.presupuesto_total > 0 THEN
            ROUND(LEAST((COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total, 1.0) * 100.0, 1)
          WHEN p.horas_estimadas > 0 AND p.presupuesto_total > 0 THEN
            ROUND(
              (LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 57.14) +
              (LEAST(COALESCE(h.costo_horas, 0) + COALESCE(g.total_gastos, 0), p.presupuesto_total) / p.presupuesto_total * 42.86),
              1
            )
          WHEN p.horas_estimadas > 0 THEN
            ROUND(LEAST(COALESCE(h.total_horas, 0) / p.horas_estimadas, 1.0) * 100.0, 1)
          ELSE 0.0
        END
      ))
  END AS avance_calculado
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
