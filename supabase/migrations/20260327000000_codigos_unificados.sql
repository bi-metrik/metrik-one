-- ============================================================
-- Codigos unificados: FAB para empresas, FAB-1 para oportunidades
-- ============================================================

-- Asegurar extension unaccent
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================================
-- EMPRESAS: codigo de 3 letras con anti-colision
-- ============================================================

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codigo TEXT;

-- Funcion: generar codigo de 3 letras a partir del nombre
CREATE OR REPLACE FUNCTION generate_empresa_codigo(p_workspace_id UUID, p_nombre TEXT)
RETURNS TEXT AS $$
DECLARE
  v_clean TEXT;
  v_base TEXT;
  v_candidate TEXT;
  v_i INT;
  v_j INT;
BEGIN
  -- Limpiar: quitar acentos, mayusculas, solo letras
  v_clean := UPPER(unaccent(COALESCE(p_nombre, 'EMP')));
  v_clean := REGEXP_REPLACE(v_clean, '[^A-Z]', '', 'g');

  -- Si queda vacio
  IF LENGTH(v_clean) < 3 THEN
    v_clean := v_clean || 'XXX';
  END IF;

  -- Tomar primeras 3 letras
  v_base := SUBSTRING(v_clean FROM 1 FOR 3);
  v_candidate := v_base;

  -- Anti-colision: si ya existe, incrementar 3ra letra
  WHILE EXISTS (
    SELECT 1 FROM empresas
    WHERE workspace_id = p_workspace_id AND codigo = v_candidate
  ) LOOP
    -- Incrementar 3ra letra
    v_i := ASCII(SUBSTRING(v_candidate FROM 3 FOR 1));
    IF v_i < ASCII('Z') THEN
      v_candidate := SUBSTRING(v_candidate FROM 1 FOR 2) || CHR(v_i + 1);
    ELSE
      -- 3ra letra llego a Z, incrementar 2da
      v_j := ASCII(SUBSTRING(v_candidate FROM 2 FOR 1));
      IF v_j < ASCII('Z') THEN
        v_candidate := SUBSTRING(v_candidate FROM 1 FOR 1) || CHR(v_j + 1) || 'A';
      ELSE
        -- Fallback: agregar digito
        v_candidate := v_base || '1';
        EXIT;
      END IF;
    END IF;
  END LOOP;

  RETURN v_candidate;
END;
$$ LANGUAGE plpgsql;

-- Trigger BEFORE INSERT en empresas
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
-- OPORTUNIDADES: codigo = empresa.codigo + '-' + seq
-- ============================================================

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS codigo TEXT;

CREATE OR REPLACE FUNCTION trg_oportunidad_auto_codigo()
RETURNS TRIGGER AS $$
DECLARE
  v_empresa_codigo TEXT;
  v_next_seq INT;
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    -- Obtener codigo de empresa
    SELECT codigo INTO v_empresa_codigo
    FROM empresas
    WHERE id = NEW.empresa_id;

    -- Siguiente secuencia global para esta empresa
    SELECT COUNT(*) + 1 INTO v_next_seq
    FROM oportunidades
    WHERE empresa_id = NEW.empresa_id;

    NEW.codigo := COALESCE(v_empresa_codigo, 'SIN') || '-' || v_next_seq;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS oportunidad_auto_codigo ON oportunidades;
CREATE TRIGGER oportunidad_auto_codigo
  BEFORE INSERT ON oportunidades
  FOR EACH ROW EXECUTE FUNCTION trg_oportunidad_auto_codigo();

-- ============================================================
-- PROYECTOS: cambiar codigo de SMALLINT a TEXT
-- ============================================================

-- Cambiar tipo (preservar datos existentes como P-001)
ALTER TABLE proyectos ALTER COLUMN codigo TYPE TEXT USING
  CASE WHEN codigo IS NOT NULL AND codigo > 0
    THEN 'P-' || LPAD(codigo::TEXT, 3, '0')
    ELSE NULL
  END;

-- Eliminar default anterior
ALTER TABLE proyectos ALTER COLUMN codigo DROP DEFAULT;

-- Eliminar constraint anterior (si existe)
DROP INDEX IF EXISTS idx_proyectos_workspace_codigo;

-- Nuevo unique index para TEXT
CREATE UNIQUE INDEX IF NOT EXISTS uq_proyecto_codigo
  ON proyectos(workspace_id, codigo);

-- Unique indexes para empresas y oportunidades
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresa_codigo
  ON empresas(workspace_id, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_oportunidad_codigo
  ON oportunidades(workspace_id, codigo);

-- ============================================================
-- BACKFILL: empresas existentes sin codigo
-- ============================================================
UPDATE empresas SET codigo = generate_empresa_codigo(workspace_id, nombre)
WHERE codigo IS NULL OR codigo = '';

ALTER TABLE empresas ALTER COLUMN codigo SET NOT NULL;

-- ============================================================
-- BACKFILL: oportunidades existentes sin codigo
-- ============================================================
WITH numbered AS (
  SELECT
    o.id,
    COALESCE(e.codigo, 'SIN') || '-' || ROW_NUMBER() OVER (
      PARTITION BY o.empresa_id ORDER BY o.created_at
    ) AS new_codigo
  FROM oportunidades o
  JOIN empresas e ON e.id = o.empresa_id
  WHERE o.codigo IS NULL OR o.codigo = ''
)
UPDATE oportunidades
SET codigo = numbered.new_codigo
FROM numbered
WHERE oportunidades.id = numbered.id;

ALTER TABLE oportunidades ALTER COLUMN codigo SET NOT NULL;
