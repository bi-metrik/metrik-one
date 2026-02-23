-- ═══════════════════════════════════════════════════════════
-- Migración: Proyectos Internos (D93-D97)
-- ═══════════════════════════════════════════════════════════

-- §1. Columna tipo (D93)
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'cliente'
  CHECK (tipo IN ('cliente', 'interno'));

-- §2. Campos ROI opcionales (D97)
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS roi_descripcion TEXT;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS roi_retorno_estimado NUMERIC(15,2);

-- §3. Índice para queries por tipo+estado
CREATE INDEX IF NOT EXISTS idx_proyectos_tipo_estado ON proyectos(workspace_id, tipo, estado);

-- §4. Recrear vista v_proyecto_financiero con p.tipo
-- DROP first because adding a column changes the view signature
DROP VIEW IF EXISTS v_proyecto_financiero;
CREATE VIEW v_proyecto_financiero AS
SELECT
  p.id AS proyecto_id,
  p.workspace_id,
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

  -- Costo por horas (horas × costo_hora del personal principal)
  COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0) AS costo_horas,

  -- Gastos directos
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

  -- Cartera = facturado - cobrado
  COALESCE(f.total_facturado, 0) - COALESCE(c.total_cobrado, 0) AS cartera,

  -- Por facturar = presupuesto - facturado
  p.presupuesto_total - COALESCE(f.total_facturado, 0) AS por_facturar,

  -- Ganancia real en tiempo real
  COALESCE(c.total_cobrado, 0)
    - ((COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0))
    AS ganancia_real

FROM proyectos p

LEFT JOIN empresas e ON e.id = p.empresa_id
LEFT JOIN contactos ct ON ct.id = p.contacto_id

-- Personal principal para costo_hora (MVP: 1 persona por workspace)
LEFT JOIN LATERAL (
  SELECT (s.salary / NULLIF(s.horas_disponibles_mes, 0)) AS costo_hora_calc
  FROM staff s
  WHERE s.workspace_id = p.workspace_id AND s.es_principal = true AND s.is_active = true
  LIMIT 1
) per ON true

-- Total horas
LEFT JOIN LATERAL (
  SELECT SUM(hr.horas) AS total_horas
  FROM horas hr
  WHERE hr.proyecto_id = p.id
) h ON true

-- Total gastos directos
LEFT JOIN LATERAL (
  SELECT SUM(gs.monto) AS total_gastos
  FROM gastos gs
  WHERE gs.proyecto_id = p.id
) g ON true

-- Total facturado
LEFT JOIN LATERAL (
  SELECT SUM(fa.monto) AS total_facturado, COUNT(*) AS num_facturas
  FROM facturas fa
  WHERE fa.proyecto_id = p.id
) f ON true

-- Total cobrado
LEFT JOIN LATERAL (
  SELECT SUM(co.monto) AS total_cobrado
  FROM cobros co
  WHERE co.proyecto_id = p.id
) c ON true;
