-- ============================================================
-- Codigo unico para cotizaciones: FAB-1-C1, FAB-1-C2, etc.
-- Hereda codigo de oportunidad + "-C" + secuencia por oportunidad
-- ============================================================

-- 1. Columna codigo
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS codigo TEXT;

-- 2. Trigger function
CREATE OR REPLACE FUNCTION trg_cotizacion_auto_codigo()
RETURNS TRIGGER AS $$
DECLARE
  v_opp_codigo TEXT;
  v_next_seq INT;
BEGIN
  -- Obtener codigo de la oportunidad padre
  SELECT codigo INTO v_opp_codigo
  FROM oportunidades
  WHERE id = NEW.oportunidad_id;

  -- Siguiente secuencia para esta oportunidad
  SELECT COUNT(*) + 1 INTO v_next_seq
  FROM cotizaciones
  WHERE oportunidad_id = NEW.oportunidad_id;

  NEW.codigo := COALESCE(v_opp_codigo, 'SIN') || '-C' || v_next_seq;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger
DROP TRIGGER IF EXISTS cotizacion_auto_codigo ON cotizaciones;
CREATE TRIGGER cotizacion_auto_codigo
  BEFORE INSERT ON cotizaciones
  FOR EACH ROW EXECUTE FUNCTION trg_cotizacion_auto_codigo();

-- 4. Backfill cotizaciones existentes (ordenadas por created_at)
WITH numbered AS (
  SELECT
    c.id,
    COALESCE(o.codigo, 'SIN') || '-C' || ROW_NUMBER() OVER (
      PARTITION BY c.oportunidad_id ORDER BY c.created_at
    ) AS new_codigo
  FROM cotizaciones c
  JOIN oportunidades o ON o.id = c.oportunidad_id
)
UPDATE cotizaciones
SET codigo = numbered.new_codigo
FROM numbered
WHERE cotizaciones.id = numbered.id;

-- 5. NOT NULL despues de backfill
ALTER TABLE cotizaciones ALTER COLUMN codigo SET NOT NULL;

-- 6. Unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizacion_codigo
  ON cotizaciones(workspace_id, codigo);
