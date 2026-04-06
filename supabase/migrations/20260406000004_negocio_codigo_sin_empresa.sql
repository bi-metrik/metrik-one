-- ============================================================
-- Fix: negocios.codigo para persona natural (empresa_id IS NULL)
--
-- El trigger anterior solo generaba código si empresa_id IS NOT NULL.
-- Para persona natural, se usa la primera letra del nombre del contacto.
-- Formato: primera_letra_contacto + año2dig + consecutivo
-- Ejemplo: Juan Pérez → J2601 (primer negocio del año 2026 para "J")
-- ============================================================

-- ── 1. Función para generar código sin empresa ────────────────────────────────

CREATE OR REPLACE FUNCTION generate_negocio_codigo_sin_empresa(
  p_contacto_id UUID,
  p_workspace_id UUID
)
RETURNS VARCHAR(20) AS $$
DECLARE
  v_letra     CHAR(1);
  v_anio_2dig TEXT;
  v_prefix    TEXT;
  v_max       INT;
BEGIN
  -- Primera letra del nombre del contacto (mayúscula)
  IF p_contacto_id IS NOT NULL THEN
    SELECT UPPER(LEFT(TRIM(COALESCE(nombre, 'P')), 1))
    INTO v_letra
    FROM contactos
    WHERE id = p_contacto_id;
  END IF;

  -- Fallback: 'P' para persona natural sin contacto válido
  IF v_letra IS NULL OR v_letra !~ '^[A-Z]$' THEN
    v_letra := 'P';
  END IF;

  v_anio_2dig := TO_CHAR(NOW(), 'YY');
  v_prefix    := v_letra || v_anio_2dig;

  -- Consecutivo dentro de persona_natural (empresa_id IS NULL), mismo workspace y letra/año
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(codigo FROM LENGTH(v_prefix) + 1) AS INTEGER)
  ), 0)
  INTO v_max
  FROM negocios
  WHERE workspace_id  = p_workspace_id
    AND empresa_id    IS NULL
    AND codigo        IS NOT NULL
    AND codigo        LIKE v_prefix || '%'
    AND SUBSTRING(codigo FROM LENGTH(v_prefix) + 1) ~ '^\d+$';

  RETURN v_prefix || (v_max + 1)::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Actualizar trigger para manejar ambos casos ────────────────────────────

CREATE OR REPLACE FUNCTION trg_negocio_auto_codigo()
RETURNS TRIGGER AS $$
BEGIN
  -- Ya tiene código: no hacer nada
  IF NEW.codigo IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.empresa_id IS NOT NULL THEN
    NEW.codigo := generate_negocio_codigo(NEW.empresa_id, NEW.workspace_id);
  ELSE
    -- Persona natural: usar primera letra del contacto
    NEW.codigo := generate_negocio_codigo_sin_empresa(NEW.contacto_id, NEW.workspace_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Backfill: asignar código a negocios existentes sin código ──────────────

DO $$
DECLARE
  neg RECORD;
BEGIN
  FOR neg IN
    SELECT id, empresa_id, contacto_id, workspace_id
    FROM negocios
    WHERE codigo IS NULL
    ORDER BY workspace_id, created_at ASC
  LOOP
    IF neg.empresa_id IS NOT NULL THEN
      UPDATE negocios
      SET codigo = generate_negocio_codigo(neg.empresa_id, neg.workspace_id)
      WHERE id = neg.id;
    ELSE
      UPDATE negocios
      SET codigo = generate_negocio_codigo_sin_empresa(neg.contacto_id, neg.workspace_id)
      WHERE id = neg.id;
    END IF;
  END LOOP;
END;
$$;
