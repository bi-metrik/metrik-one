-- ============================================================
-- Fix: códigos de negocio con espacios para legibilidad
-- Antes: S12603  →  Ahora: S1 26 3
-- Formato: empresa_codigo + ' ' + año2dig + ' ' + consecutivo
-- ============================================================

-- ── 1. Actualizar función principal (con empresa) ───────────────────────────

CREATE OR REPLACE FUNCTION generate_negocio_codigo(p_empresa_id UUID, p_workspace_id UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
  v_empresa_codigo TEXT;
  v_anio_2dig      TEXT;
  v_prefix         TEXT;
  v_max            INT;
BEGIN
  SELECT codigo INTO v_empresa_codigo
  FROM empresas
  WHERE id = p_empresa_id;

  IF v_empresa_codigo IS NULL THEN
    RETURN 'X' || ' ' || TO_CHAR(NOW(), 'YY') || ' ' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT;
  END IF;

  v_anio_2dig := TO_CHAR(NOW(), 'YY');
  -- Prefix para buscar: "S1 26" (con espacio)
  v_prefix := v_empresa_codigo || ' ' || v_anio_2dig || ' ';

  -- Buscar mayor consecutivo (el consecutivo es lo que sigue después del último espacio)
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

-- ── 2. Actualizar función sin empresa (persona natural fallback) ────────────

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
  IF p_contacto_id IS NOT NULL THEN
    SELECT UPPER(LEFT(TRIM(COALESCE(nombre, 'P')), 1))
    INTO v_letra
    FROM contactos
    WHERE id = p_contacto_id;
  END IF;

  IF v_letra IS NULL OR v_letra !~ '^[A-Z]$' THEN
    v_letra := 'P';
  END IF;

  v_anio_2dig := TO_CHAR(NOW(), 'YY');
  v_prefix    := v_letra || ' ' || v_anio_2dig || ' ';

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

-- ── 3. Backfill: convertir códigos existentes al formato con espacios ───────
-- Patrón viejo: LetraNúmero + 2digAño + Consecutivo (ej: S12603)
-- Patrón nuevo: LetraNúmero + ' ' + 2digAño + ' ' + Consecutivo (ej: S1 26 3)

DO $$
DECLARE
  neg RECORD;
  v_emp_codigo TEXT;
  v_rest       TEXT;
  v_anio       TEXT;
  v_consec     TEXT;
  v_new_codigo TEXT;
BEGIN
  FOR neg IN
    SELECT n.id, n.codigo, n.empresa_id, e.codigo AS emp_codigo
    FROM negocios n
    LEFT JOIN empresas e ON e.id = n.empresa_id
    WHERE n.codigo IS NOT NULL
      AND n.codigo NOT LIKE '% %'  -- Solo los que NO tienen espacios ya
    ORDER BY n.workspace_id, n.created_at ASC
  LOOP
    IF neg.emp_codigo IS NOT NULL AND neg.codigo LIKE neg.emp_codigo || '%' THEN
      -- Tiene empresa: quitar prefijo empresa, extraer año y consecutivo
      v_rest := SUBSTRING(neg.codigo FROM LENGTH(neg.emp_codigo) + 1);
      IF LENGTH(v_rest) >= 3 AND LEFT(v_rest, 2) ~ '^\d{2}$' THEN
        v_anio   := LEFT(v_rest, 2);
        v_consec := SUBSTRING(v_rest FROM 3);
        v_new_codigo := neg.emp_codigo || ' ' || v_anio || ' ' || v_consec;
        UPDATE negocios SET codigo = v_new_codigo WHERE id = neg.id;
      END IF;
    ELSE
      -- Sin empresa (persona natural): formato es Letra + 2digAño + Consecutivo
      IF LENGTH(neg.codigo) >= 4 AND LEFT(neg.codigo, 1) ~ '^[A-Z]$'
         AND SUBSTRING(neg.codigo FROM 2 FOR 2) ~ '^\d{2}$' THEN
        v_anio   := SUBSTRING(neg.codigo FROM 2 FOR 2);
        v_consec := SUBSTRING(neg.codigo FROM 4);
        v_new_codigo := LEFT(neg.codigo, 1) || ' ' || v_anio || ' ' || v_consec;
        UPDATE negocios SET codigo = v_new_codigo WHERE id = neg.id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- ── 4. Recrear unique index (los valores cambiaron) ────────────────────────
DROP INDEX IF EXISTS uq_negocio_codigo;
CREATE UNIQUE INDEX uq_negocio_codigo ON negocios(workspace_id, codigo);
