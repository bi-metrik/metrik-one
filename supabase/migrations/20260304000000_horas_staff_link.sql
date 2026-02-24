-- ═══════════════════════════════════════════════════════════
-- Migración: Vincular horas a staff para cruce con rubros de MO
-- ═══════════════════════════════════════════════════════════

-- §1. Agregar staff_id a horas
ALTER TABLE horas ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES staff(id);
CREATE INDEX IF NOT EXISTS idx_horas_staff ON horas(staff_id);

-- §2. Backfill: asignar horas existentes al staff principal del workspace
UPDATE horas h
SET staff_id = (
  SELECT s.id FROM staff s
  WHERE s.workspace_id = h.workspace_id
    AND s.es_principal = true
    AND s.is_active = true
  LIMIT 1
)
WHERE h.staff_id IS NULL;

-- §3. Recrear v_proyecto_rubros_comparativo
-- Mo_propia y mo_terceros cruzan con horas+staff, el resto con gastos
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
    WHEN pr.tipo = 'mo_propia' THEN COALESCE(mo.costo_mo, 0)
    WHEN pr.tipo = 'mo_terceros' THEN COALESCE(mt.costo_mo, 0)
    ELSE COALESCE(g.total_gastos, 0)
  END AS gastado_real,
  pr.presupuestado - CASE
    WHEN pr.tipo = 'mo_propia' THEN COALESCE(mo.costo_mo, 0)
    WHEN pr.tipo = 'mo_terceros' THEN COALESCE(mt.costo_mo, 0)
    ELSE COALESCE(g.total_gastos, 0)
  END AS diferencia,
  CASE WHEN pr.presupuestado > 0 THEN
    ROUND((CASE
      WHEN pr.tipo = 'mo_propia' THEN COALESCE(mo.costo_mo, 0)
      WHEN pr.tipo = 'mo_terceros' THEN COALESCE(mt.costo_mo, 0)
      ELSE COALESCE(g.total_gastos, 0)
    END / pr.presupuestado) * 100, 1)
  ELSE 0 END AS consumido_pct
FROM proyecto_rubros pr

-- Gastos para rubros que no son mano de obra
LEFT JOIN LATERAL (
  SELECT SUM(gs.monto) AS total_gastos
  FROM gastos gs
  WHERE gs.rubro_id = pr.id
) g ON true

-- Mo propia: horas de empleados en este proyecto
LEFT JOIN LATERAL (
  SELECT SUM(hr.horas * COALESCE(s.salary / NULLIF(s.horas_disponibles_mes, 0), 0)) AS costo_mo
  FROM horas hr
  JOIN staff s ON s.id = hr.staff_id
  WHERE hr.proyecto_id = pr.proyecto_id
    AND s.tipo_vinculo = 'empleado'
) mo ON pr.tipo = 'mo_propia'

-- Mo terceros: horas de contratistas/freelance en este proyecto
LEFT JOIN LATERAL (
  SELECT SUM(hr.horas * COALESCE(s.salary / NULLIF(s.horas_disponibles_mes, 0), 0)) AS costo_mo
  FROM horas hr
  JOIN staff s ON s.id = hr.staff_id
  WHERE hr.proyecto_id = pr.proyecto_id
    AND s.tipo_vinculo IN ('contratista', 'freelance')
) mt ON pr.tipo = 'mo_terceros';


-- §4. Recrear v_proyecto_financiero con costo por staff
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

  -- Horas reales (todas, sin importar staff)
  COALESCE(h.total_horas, 0) AS horas_reales,

  -- Costo por horas: suma de (horas × rate) por cada staff
  COALESCE(hc.costo_horas_calc, 0) AS costo_horas,

  -- Gastos directos
  COALESCE(g.total_gastos, 0) AS gastos_directos,

  -- Costo acumulado total
  COALESCE(hc.costo_horas_calc, 0) + COALESCE(g.total_gastos, 0) AS costo_acumulado,

  -- Presupuesto consumido %
  CASE WHEN p.presupuesto_total > 0 THEN
    ROUND(((COALESCE(hc.costo_horas_calc, 0) + COALESCE(g.total_gastos, 0)) / p.presupuesto_total) * 100, 1)
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
    - (COALESCE(hc.costo_horas_calc, 0) + COALESCE(g.total_gastos, 0))
    AS ganancia_real

FROM proyectos p

LEFT JOIN empresas e ON e.id = p.empresa_id
LEFT JOIN contactos ct ON ct.id = p.contacto_id

-- Costo de horas por staff (reemplaza el cálculo global con staff principal)
LEFT JOIN LATERAL (
  SELECT SUM(
    hr.horas * COALESCE(s.salary / NULLIF(s.horas_disponibles_mes, 0), 0)
  ) AS costo_horas_calc
  FROM horas hr
  LEFT JOIN staff s ON s.id = hr.staff_id
  WHERE hr.proyecto_id = p.id
) hc ON true

-- Total horas (conteo simple)
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
