-- ============================================================
-- Sistema de codigos unificados: FAB-1
-- Empresa: 3 letras auto (anti-colision)
-- Oportunidad: empresa_codigo + seq global por empresa
-- Proyecto: hereda codigo de oportunidad o INT-N para internos
-- ============================================================

-- ============================================================
-- 1. EMPRESAS — codigo de 3 letras
-- ============================================================

-- 1A. Columna codigo
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codigo TEXT;

-- 1B. Funcion para generar codigo de empresa (3 letras, anti-colision)
CREATE OR REPLACE FUNCTION generate_empresa_codigo(p_workspace_id UUID, p_nombre TEXT)
RETURNS TEXT AS $$
DECLARE
  v_clean TEXT;
  v_base TEXT;
  v_candidate TEXT;
  v_i INT;
  v_j INT;
  v_c1 INT;
  v_c2 INT;
  v_c3 INT;
BEGIN
  -- Limpiar: UPPER, quitar acentos, solo letras A-Z
  v_clean := UPPER(unaccent(p_nombre));
  v_clean := REGEXP_REPLACE(v_clean, '[^A-Z]', '', 'g');

  -- Si menos de 3 letras, pad con X
  v_clean := RPAD(v_clean, 3, 'X');

  -- Base: primeras 3 letras
  v_base := SUBSTRING(v_clean FROM 1 FOR 3);
  v_candidate := v_base;

  -- Anti-colision: si existe, incrementar 3ra letra, luego 2da, luego 1ra
  v_c1 := ASCII(SUBSTRING(v_base FROM 1 FOR 1));
  v_c2 := ASCII(SUBSTRING(v_base FROM 2 FOR 1));
  v_c3 := ASCII(SUBSTRING(v_base FROM 3 FOR 1));

  WHILE EXISTS (SELECT 1 FROM empresas WHERE workspace_id = p_workspace_id AND codigo = v_candidate) LOOP
    -- Incrementar 3ra letra
    v_c3 := v_c3 + 1;
    IF v_c3 > 90 THEN -- past Z
      v_c3 := 65; -- reset to A
      -- Incrementar 2da letra
      v_c2 := v_c2 + 1;
      IF v_c2 > 90 THEN
        v_c2 := 65;
        -- Incrementar 1ra letra
        v_c1 := v_c1 + 1;
        IF v_c1 > 90 THEN
          -- Fallback extremo: usar hash
          RETURN UPPER(SUBSTRING(MD5(p_nombre || p_workspace_id::TEXT) FROM 1 FOR 3));
        END IF;
      END IF;
    END IF;
    v_candidate := CHR(v_c1) || CHR(v_c2) || CHR(v_c3);
  END LOOP;

  RETURN v_candidate;
END;
$$ LANGUAGE plpgsql;

-- 1C. Trigger BEFORE INSERT en empresas
CREATE OR REPLACE FUNCTION trg_empresa_auto_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    NEW.codigo := generate_empresa_codigo(NEW.workspace_id, NEW.nombre);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS empresa_auto_codigo ON empresas;
CREATE TRIGGER empresa_auto_codigo
  BEFORE INSERT ON empresas
  FOR EACH ROW EXECUTE FUNCTION trg_empresa_auto_codigo();


-- ============================================================
-- 2. OPORTUNIDADES — codigo = empresa_codigo + seq
-- ============================================================

-- 2A. Columna codigo
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS codigo TEXT;

-- 2B. Funcion para generar codigo de oportunidad
CREATE OR REPLACE FUNCTION generate_oportunidad_codigo(p_workspace_id UUID, p_empresa_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_empresa_codigo TEXT;
  v_next_seq INT;
BEGIN
  -- Obtener codigo de empresa
  SELECT codigo INTO v_empresa_codigo FROM empresas WHERE id = p_empresa_id;

  IF v_empresa_codigo IS NULL THEN
    RAISE EXCEPTION 'Empresa % no tiene codigo asignado', p_empresa_id;
  END IF;

  -- Contar oportunidades existentes para esta empresa en este workspace
  SELECT COALESCE(MAX(
    CASE
      WHEN o.codigo ~ ('^' || v_empresa_codigo || '-\d+$')
      THEN SUBSTRING(o.codigo FROM LENGTH(v_empresa_codigo) + 2)::INT
      ELSE 0
    END
  ), 0) + 1
  INTO v_next_seq
  FROM oportunidades o
  WHERE o.workspace_id = p_workspace_id AND o.empresa_id = p_empresa_id;

  RETURN v_empresa_codigo || '-' || v_next_seq;
END;
$$ LANGUAGE plpgsql;

-- 2C. Trigger BEFORE INSERT en oportunidades
CREATE OR REPLACE FUNCTION trg_oportunidad_auto_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    NEW.codigo := generate_oportunidad_codigo(NEW.workspace_id, NEW.empresa_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS oportunidad_auto_codigo ON oportunidades;
CREATE TRIGGER oportunidad_auto_codigo
  BEFORE INSERT ON oportunidades
  FOR EACH ROW EXECUTE FUNCTION trg_oportunidad_auto_codigo();


-- ============================================================
-- 3. PROYECTOS — cambiar SMALLINT a TEXT, nuevo trigger
-- ============================================================

-- 3A. Drop dependientes ANTES de cambiar tipo de columna
DROP FUNCTION IF EXISTS wa_find_projects(UUID, TEXT, INT);
DROP VIEW IF EXISTS v_proyecto_financiero;
DROP TRIGGER IF EXISTS proyecto_auto_nombre ON proyectos;
DROP FUNCTION IF EXISTS trg_proyecto_auto_nombre();
DROP FUNCTION IF EXISTS get_next_proyecto_codigo(UUID);

-- 3B. Quitar constraint unique viejo y default
DROP INDEX IF EXISTS idx_proyectos_workspace_codigo;
ALTER TABLE proyectos ALTER COLUMN codigo DROP DEFAULT;
ALTER TABLE proyectos ALTER COLUMN codigo DROP NOT NULL;

-- 3C. Cambiar tipo de SMALLINT a TEXT
ALTER TABLE proyectos ALTER COLUMN codigo TYPE TEXT USING
  CASE WHEN codigo IS NOT NULL AND codigo > 0 THEN 'P-' || LPAD(codigo::TEXT, 3, '0') ELSE NULL END;

-- 3D. Nuevo trigger: hereda codigo de oportunidad o genera INT-N
CREATE OR REPLACE FUNCTION trg_proyecto_auto_nombre()
RETURNS TRIGGER AS $$
DECLARE
  v_empresa_nombre TEXT;
  v_oportunidad_codigo TEXT;
  v_next_int_seq INT;
BEGIN
  -- Obtener nombre de empresa
  IF NEW.empresa_id IS NOT NULL THEN
    SELECT nombre INTO v_empresa_nombre FROM empresas WHERE id = NEW.empresa_id;
  END IF;

  -- Asignar codigo
  IF NEW.oportunidad_id IS NOT NULL THEN
    -- Proyecto de oportunidad: heredar codigo de la oportunidad
    SELECT codigo INTO v_oportunidad_codigo FROM oportunidades WHERE id = NEW.oportunidad_id;
    NEW.codigo := v_oportunidad_codigo;
  ELSE
    -- Proyecto interno: generar INT-N
    SELECT COALESCE(MAX(
      CASE
        WHEN p.codigo ~ '^INT-\d+$'
        THEN SUBSTRING(p.codigo FROM 5)::INT
        ELSE 0
      END
    ), 0) + 1
    INTO v_next_int_seq
    FROM proyectos p
    WHERE p.workspace_id = NEW.workspace_id;

    NEW.codigo := 'INT-' || v_next_int_seq;
  END IF;

  -- Generar nombre: "CODIGO · Empresa · Descripcion"
  NEW.nombre := COALESCE(NEW.codigo, 'SIN-COD')
    || ' · ' || COALESCE(v_empresa_nombre, 'Interno')
    || ' · ' || NEW.nombre;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER proyecto_auto_nombre
  BEFORE INSERT ON proyectos
  FOR EACH ROW EXECUTE FUNCTION trg_proyecto_auto_nombre();


-- ============================================================
-- 4. BACKFILL: empresas existentes
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, workspace_id, nombre
    FROM empresas
    WHERE codigo IS NULL
    ORDER BY created_at
  LOOP
    UPDATE empresas
    SET codigo = generate_empresa_codigo(r.workspace_id, r.nombre)
    WHERE id = r.id;
  END LOOP;
END $$;

-- Ahora NOT NULL
ALTER TABLE empresas ALTER COLUMN codigo SET NOT NULL;

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresa_codigo ON empresas(workspace_id, codigo);


-- ============================================================
-- 5. BACKFILL: oportunidades existentes
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, workspace_id, empresa_id
    FROM oportunidades
    WHERE codigo IS NULL
    ORDER BY created_at
  LOOP
    UPDATE oportunidades
    SET codigo = generate_oportunidad_codigo(r.workspace_id, r.empresa_id)
    WHERE id = r.id;
  END LOOP;
END $$;

-- NOT NULL
ALTER TABLE oportunidades ALTER COLUMN codigo SET NOT NULL;

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_oportunidad_codigo ON oportunidades(workspace_id, codigo);


-- ============================================================
-- 6. BACKFILL: proyectos existentes que tienen oportunidad_id
-- ============================================================
UPDATE proyectos p
SET codigo = o.codigo
FROM oportunidades o
WHERE o.id = p.oportunidad_id
  AND p.oportunidad_id IS NOT NULL
  AND (p.codigo IS NULL OR p.codigo LIKE 'P-%');

-- Proyectos internos (sin oportunidad_id) que aun tienen codigo viejo
DO $$
DECLARE
  r RECORD;
  v_seq INT := 0;
BEGIN
  FOR r IN
    SELECT id, workspace_id
    FROM proyectos
    WHERE oportunidad_id IS NULL
      AND (codigo IS NULL OR codigo LIKE 'P-%')
    ORDER BY created_at
  LOOP
    v_seq := v_seq + 1;
    UPDATE proyectos SET codigo = 'INT-' || v_seq WHERE id = r.id;
  END LOOP;
END $$;

-- NOT NULL + Unique
ALTER TABLE proyectos ALTER COLUMN codigo SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_proyecto_codigo ON proyectos(workspace_id, codigo);


-- ============================================================
-- 7. Recrear vista v_proyecto_financiero con empresa_codigo
-- ============================================================
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
  e.codigo AS empresa_codigo,
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

  -- Ganancia real en tiempo real
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
-- 8. Recrear RPC wa_find_projects con TEXT codigo
-- ============================================================
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
  -- Si hint tiene formato de codigo (ej: FAB-1, INT-3) -> match exacto
  IF p_hint ~ '^[A-Z]{2,3}-\d+$' THEN
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

    -- Si encontro match, retornar
    IF FOUND THEN RETURN; END IF;

    -- Si no, tambien buscar en oportunidades (podria ser O no P)
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
      AND v.empresa_codigo = UPPER(SPLIT_PART(p_hint, '-', 1))
    LIMIT p_limit;

    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Si hint es solo letras (ej: FAB) -> match por empresa_codigo
  IF p_hint ~ '^[A-Za-z]{2,3}$' THEN
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
      AND UPPER(v.empresa_codigo) = UPPER(p_hint)
    ORDER BY v.created_at DESC
    LIMIT p_limit;

    IF FOUND THEN RETURN; END IF;
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
