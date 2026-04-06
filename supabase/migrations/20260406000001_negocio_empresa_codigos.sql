-- ============================================================
-- Sistema de IDs: empresas.codigo (L1, L2...) + negocios.codigo (L126N)
--
-- Cambio vs sistema anterior (3 letras: TEC, CAF...):
--   Nuevo formato empresa: primera_letra + consecutivo_por_letra (S1, S2, M1)
--   Nuevo formato negocio: empresa_codigo + año2dig + consecutivo (S12603)
--   Display negocio en UI: S1 26 3 (con espacios, sin leading zeros)
-- ============================================================

-- ============================================================
-- 1. EMPRESAS: reemplazar generador (3 letras → L+N)
-- ============================================================

-- Quitar NOT NULL temporalmente para poder recalcular
ALTER TABLE empresas ALTER COLUMN codigo DROP NOT NULL;

-- Reemplazar función de generación
CREATE OR REPLACE FUNCTION generate_empresa_codigo(p_workspace_id UUID, p_nombre TEXT)
RETURNS TEXT AS $$
DECLARE
  v_letra  CHAR(1);
  v_max    INT;
BEGIN
  -- Primera letra del nombre, limpia y en mayúscula
  v_letra := UPPER(LEFT(TRIM(COALESCE(p_nombre, 'X')), 1));
  -- Solo letras A-Z; fallback a 'X' si no es letra
  IF v_letra !~ '^[A-Z]$' THEN
    v_letra := 'X';
  END IF;

  -- Máximo consecutivo existente para esa letra en ese workspace
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(codigo FROM 2) AS INTEGER)
  ), 0)
  INTO v_max
  FROM empresas
  WHERE workspace_id = p_workspace_id
    AND codigo IS NOT NULL
    AND LEFT(codigo, 1) = v_letra
    AND LENGTH(codigo) > 1
    AND SUBSTRING(codigo FROM 2) ~ '^\d+$';

  RETURN v_letra || (v_max + 1)::TEXT;
END;
$$ LANGUAGE plpgsql;

-- El trigger ya existe (trg_empresa_auto_codigo), solo necesita la función actualizada.
-- Recreamos para asegurar que apunta a la función nueva.
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
-- 2. BACKFILL empresas: recalcular con nuevo formato
--    Procesar en orden created_at para asignar consecutivos
--    correctos dentro de cada (workspace, letra)
-- ============================================================
DO $$
DECLARE
  emp RECORD;
BEGIN
  -- Primero limpiar todos los códigos para recalcular limpio
  UPDATE empresas SET codigo = NULL;

  -- Reasignar en orden creación
  FOR emp IN
    SELECT id, nombre, workspace_id
    FROM empresas
    ORDER BY workspace_id, created_at ASC
  LOOP
    UPDATE empresas
    SET codigo = generate_empresa_codigo(emp.workspace_id, emp.nombre)
    WHERE id = emp.id;
  END LOOP;
END;
$$;

-- Restaurar NOT NULL
ALTER TABLE empresas ALTER COLUMN codigo SET NOT NULL;

-- Asegurar unique index (puede ya existir, usamos IF NOT EXISTS)
DROP INDEX IF EXISTS uq_empresa_codigo;
CREATE UNIQUE INDEX uq_empresa_codigo ON empresas(workspace_id, codigo);

-- ============================================================
-- 3. NEGOCIOS: agregar columna codigo
-- ============================================================
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS codigo VARCHAR(20);

-- ============================================================
-- 4. Función para generar código de negocio
--    Formato: empresa_codigo + año2dig + consecutivo_sin_zeros
--    Ejemplo: S1 + 26 + 3 → S12603
-- ============================================================
CREATE OR REPLACE FUNCTION generate_negocio_codigo(p_empresa_id UUID, p_workspace_id UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
  v_empresa_codigo TEXT;
  v_anio_2dig      TEXT;
  v_prefix         TEXT;
  v_max            INT;
BEGIN
  -- Obtener código de empresa
  SELECT codigo INTO v_empresa_codigo
  FROM empresas
  WHERE id = p_empresa_id;

  IF v_empresa_codigo IS NULL THEN
    -- Fallback si empresa no tiene código
    RETURN 'X' || TO_CHAR(NOW(), 'YY') || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT;
  END IF;

  v_anio_2dig := TO_CHAR(NOW(), 'YY');
  v_prefix    := v_empresa_codigo || v_anio_2dig;

  -- Buscar mayor consecutivo para esta empresa en este año
  -- El consecutivo es todo lo que va después de empresa_codigo + año2dig
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(codigo FROM LENGTH(v_prefix) + 1) AS INTEGER)
  ), 0)
  INTO v_max
  FROM negocios
  WHERE workspace_id   = p_workspace_id
    AND empresa_id     = p_empresa_id
    AND codigo IS NOT NULL
    AND codigo LIKE v_prefix || '%'
    AND SUBSTRING(codigo FROM LENGTH(v_prefix) + 1) ~ '^\d+$';

  RETURN v_prefix || (v_max + 1)::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Trigger para asignar código al crear negocio
-- ============================================================
CREATE OR REPLACE FUNCTION trg_negocio_auto_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL AND NEW.empresa_id IS NOT NULL THEN
    NEW.codigo := generate_negocio_codigo(NEW.empresa_id, NEW.workspace_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS negocio_auto_codigo ON negocios;
CREATE TRIGGER negocio_auto_codigo
  BEFORE INSERT ON negocios
  FOR EACH ROW EXECUTE FUNCTION trg_negocio_auto_codigo();

-- ============================================================
-- 6. BACKFILL negocios existentes (en orden created_at)
-- ============================================================
DO $$
DECLARE
  neg RECORD;
BEGIN
  FOR neg IN
    SELECT id, empresa_id, workspace_id
    FROM negocios
    WHERE codigo IS NULL AND empresa_id IS NOT NULL
    ORDER BY workspace_id, empresa_id, created_at ASC
  LOOP
    UPDATE negocios
    SET codigo = generate_negocio_codigo(neg.empresa_id, neg.workspace_id)
    WHERE id = neg.id;
  END LOOP;
END;
$$;

-- Unique index para negocios.codigo
CREATE UNIQUE INDEX IF NOT EXISTS uq_negocio_codigo ON negocios(workspace_id, codigo);
