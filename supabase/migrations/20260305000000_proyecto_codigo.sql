-- ============================================================
-- Proyecto: Código corto + nombre auto-generado
-- Agrega codigo secuencial por workspace y trigger que
-- auto-genera el nombre: "P-001 · Empresa · Descripción"
-- ============================================================

-- 1. Agregar columna codigo (nullable primero para backfill)
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS codigo SMALLINT;

-- 2. Función: obtener siguiente código por workspace
CREATE OR REPLACE FUNCTION get_next_proyecto_codigo(p_workspace_id UUID)
RETURNS SMALLINT AS $$
  SELECT (COALESCE(MAX(codigo), 0) + 1)::SMALLINT
  FROM proyectos
  WHERE workspace_id = p_workspace_id;
$$ LANGUAGE sql;

-- 3. Trigger BEFORE INSERT: asignar código + generar nombre
CREATE OR REPLACE FUNCTION trg_proyecto_auto_nombre()
RETURNS TRIGGER AS $$
DECLARE
  v_empresa_nombre TEXT;
BEGIN
  -- Asignar código secuencial por workspace
  NEW.codigo := get_next_proyecto_codigo(NEW.workspace_id);

  -- Obtener nombre de empresa si hay empresa_id
  IF NEW.empresa_id IS NOT NULL THEN
    SELECT nombre INTO v_empresa_nombre FROM empresas WHERE id = NEW.empresa_id;
  END IF;

  -- Generar nombre completo: "P-001 · Empresa · Descripción"
  NEW.nombre := 'P-' || LPAD(NEW.codigo::TEXT, 3, '0')
    || ' · ' || COALESCE(v_empresa_nombre, 'Interno')
    || ' · ' || NEW.nombre;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER proyecto_auto_nombre
  BEFORE INSERT ON proyectos
  FOR EACH ROW EXECUTE FUNCTION trg_proyecto_auto_nombre();

-- 4. Backfill: asignar códigos a proyectos existentes (por workspace, orden de creación)
WITH ranked AS (
  SELECT id, workspace_id,
    ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at) AS rn
  FROM proyectos
)
UPDATE proyectos p SET codigo = r.rn::SMALLINT
FROM ranked r WHERE p.id = r.id;

-- 5. Backfill: regenerar nombres de proyectos existentes (con empresa)
UPDATE proyectos p SET nombre =
  'P-' || LPAD(p.codigo::TEXT, 3, '0')
  || ' · ' || e.nombre
  || ' · ' || p.nombre
FROM empresas e
WHERE e.id = p.empresa_id
  AND p.nombre NOT LIKE 'P-___  · %';

-- Proyectos sin empresa (internos)
UPDATE proyectos SET nombre =
  'P-' || LPAD(codigo::TEXT, 3, '0')
  || ' · Interno · ' || nombre
WHERE empresa_id IS NULL
  AND codigo IS NOT NULL
  AND nombre NOT LIKE 'P-___  · %'
  AND nombre NOT LIKE 'P-___ · %';

-- 6. NOT NULL constraint después del backfill
ALTER TABLE proyectos ALTER COLUMN codigo SET NOT NULL;

-- 7. Unique constraint por workspace + codigo
CREATE UNIQUE INDEX IF NOT EXISTS idx_proyectos_workspace_codigo
  ON proyectos(workspace_id, codigo);

-- ============================================================
-- 8. Recrear vista v_proyecto_financiero con p.codigo
-- ============================================================
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

-- ============================================================
-- 9. Actualizar RPC wa_find_projects: incluir codigo + match por código
-- ============================================================
DROP FUNCTION IF EXISTS wa_find_projects(UUID, TEXT, INT);
CREATE FUNCTION wa_find_projects(
  p_workspace_id UUID,
  p_hint TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  codigo SMALLINT,
  nombre TEXT,
  estado TEXT,
  contacto_nombre TEXT,
  empresa_nombre TEXT,
  presupuesto_total NUMERIC,
  costo_acumulado NUMERIC,
  presupuesto_consumido_pct NUMERIC,
  horas_reales NUMERIC,
  horas_estimadas NUMERIC,
  facturado NUMERIC,
  cobrado NUMERIC,
  cartera NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  -- Si hint es numérico puro → match exacto por código
  IF p_hint ~ '^\d+$' THEN
    RETURN QUERY
    SELECT
      v.proyecto_id AS id,
      v.codigo,
      v.nombre,
      v.estado,
      v.contacto_nombre,
      v.empresa_nombre,
      v.presupuesto_total,
      v.costo_acumulado,
      v.presupuesto_consumido_pct,
      v.horas_reales,
      v.horas_estimadas,
      v.facturado,
      v.cobrado,
      v.cartera
    FROM v_proyecto_financiero v
    WHERE v.workspace_id = p_workspace_id
      AND v.estado = 'en_ejecucion'
      AND v.codigo = p_hint::SMALLINT
    LIMIT 1;
    RETURN;
  END IF;

  -- Fuzzy match por nombre, contacto o empresa
  RETURN QUERY
  SELECT
    v.proyecto_id AS id,
    v.codigo,
    v.nombre,
    v.estado,
    v.contacto_nombre,
    v.empresa_nombre,
    v.presupuesto_total,
    v.costo_acumulado,
    v.presupuesto_consumido_pct,
    v.horas_reales,
    v.horas_estimadas,
    v.facturado,
    v.cobrado,
    v.cartera
  FROM v_proyecto_financiero v
  WHERE v.workspace_id = p_workspace_id
    AND v.estado = 'en_ejecucion'
    AND (
      similarity(v.nombre, p_hint) > 0.3
      OR similarity(COALESCE(v.contacto_nombre, ''), p_hint) > 0.3
      OR similarity(COALESCE(v.empresa_nombre, ''), p_hint) > 0.3
    )
  ORDER BY GREATEST(
    similarity(v.nombre, p_hint),
    similarity(COALESCE(v.contacto_nombre, ''), p_hint),
    similarity(COALESCE(v.empresa_nombre, ''), p_hint)
  ) DESC
  LIMIT p_limit;
END;
$$;
