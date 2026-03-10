-- ============================================================
-- Fix: proyecto nombre sin prefijo de codigo
-- El trigger ahora hereda codigo de la oportunidad (FAB-1)
-- y genera nombre sin el prefijo P-001
-- ============================================================

-- Reemplazar trigger de proyecto para usar codigo de oportunidad
CREATE OR REPLACE FUNCTION trg_proyecto_auto_nombre()
RETURNS TRIGGER AS $$
DECLARE
  v_empresa_nombre TEXT;
  v_opp_codigo TEXT;
BEGIN
  -- Si viene de oportunidad, heredar su codigo
  IF NEW.oportunidad_id IS NOT NULL THEN
    SELECT codigo INTO v_opp_codigo
    FROM oportunidades
    WHERE id = NEW.oportunidad_id;

    IF v_opp_codigo IS NOT NULL AND (NEW.codigo IS NULL OR NEW.codigo = '' OR NEW.codigo = '0') THEN
      NEW.codigo := v_opp_codigo;
    END IF;
  END IF;

  -- Proyecto interno: generar INT-N
  IF NEW.tipo = 'interno' AND (NEW.codigo IS NULL OR NEW.codigo = '' OR NEW.codigo = '0') THEN
    SELECT 'INT-' || (COUNT(*) + 1)
    INTO NEW.codigo
    FROM proyectos
    WHERE workspace_id = NEW.workspace_id AND tipo = 'interno';
  END IF;

  -- Si aun no tiene codigo, generar P-NNN legacy
  IF NEW.codigo IS NULL OR NEW.codigo = '' OR NEW.codigo = '0' THEN
    SELECT 'P-' || LPAD((COALESCE(MAX(
      CASE WHEN codigo ~ '^\d+$' THEN codigo::INT
           WHEN codigo ~ '^P-\d+$' THEN SUBSTRING(codigo FROM 3)::INT
           ELSE 0 END
    ), 0) + 1)::TEXT, 3, '0')
    INTO NEW.codigo
    FROM proyectos
    WHERE workspace_id = NEW.workspace_id;
  END IF;

  -- Obtener nombre de empresa si hay empresa_id
  IF NEW.empresa_id IS NOT NULL THEN
    SELECT nombre INTO v_empresa_nombre FROM empresas WHERE id = NEW.empresa_id;
  END IF;

  -- Nombre limpio sin prefijo de codigo: "Empresa · Descripcion"
  IF NEW.nombre NOT LIKE '%·%' THEN
    NEW.nombre := COALESCE(v_empresa_nombre, 'Interno') || ' · ' || NEW.nombre;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recrear trigger (DROP + CREATE para asegurar version nueva)
DROP TRIGGER IF EXISTS proyecto_auto_nombre ON proyectos;
CREATE TRIGGER proyecto_auto_nombre
  BEFORE INSERT ON proyectos
  FOR EACH ROW EXECUTE FUNCTION trg_proyecto_auto_nombre();

-- ============================================================
-- Recrear vista con codigo TEXT
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

  -- Costo por horas
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

  -- Ganancia real
  COALESCE(c.total_cobrado, 0)
    - ((COALESCE(h.total_horas, 0) * COALESCE(per.costo_hora_calc, 0)) + COALESCE(g.total_gastos, 0))
    AS ganancia_real

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
) g ON true

LEFT JOIN LATERAL (
  SELECT SUM(fa.monto) AS total_facturado, COUNT(*) AS num_facturas
  FROM facturas fa
  WHERE fa.proyecto_id = p.id
) f ON true

LEFT JOIN LATERAL (
  SELECT SUM(co.monto) AS total_cobrado
  FROM cobros co
  WHERE co.proyecto_id = p.id
) c ON true;

-- ============================================================
-- Actualizar wa_find_projects para TEXT
-- ============================================================
DROP FUNCTION IF EXISTS wa_find_projects(UUID, TEXT, INT);
CREATE FUNCTION wa_find_projects(
  p_workspace_id UUID,
  p_hint TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  codigo TEXT,
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
  -- Match por codigo TEXT (ej: FAB-1, INT-2)
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
    AND UPPER(v.codigo) = UPPER(p_hint)
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

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
