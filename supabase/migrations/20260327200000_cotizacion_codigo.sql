-- ============================================================
-- Cotizacion: codigo unico FAB-1-C1
-- ============================================================

ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS codigo TEXT;

CREATE OR REPLACE FUNCTION trg_cotizacion_auto_codigo()
RETURNS TRIGGER AS $$
DECLARE
  v_opp_codigo TEXT;
  v_next_seq INT;
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    -- Obtener codigo de la oportunidad
    SELECT codigo INTO v_opp_codigo
    FROM oportunidades
    WHERE id = NEW.oportunidad_id;

    -- Siguiente secuencia para esta oportunidad
    SELECT COUNT(*) + 1 INTO v_next_seq
    FROM cotizaciones
    WHERE oportunidad_id = NEW.oportunidad_id;

    NEW.codigo := COALESCE(v_opp_codigo, 'SIN') || '-C' || v_next_seq;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cotizacion_auto_codigo ON cotizaciones;
CREATE TRIGGER cotizacion_auto_codigo
  BEFORE INSERT ON cotizaciones
  FOR EACH ROW EXECUTE FUNCTION trg_cotizacion_auto_codigo();

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotizacion_codigo
  ON cotizaciones(workspace_id, codigo);

-- Backfill existentes
WITH numbered AS (
  SELECT
    c.id,
    COALESCE(o.codigo, 'SIN') || '-C' || ROW_NUMBER() OVER (
      PARTITION BY c.oportunidad_id ORDER BY c.created_at
    ) AS new_codigo
  FROM cotizaciones c
  JOIN oportunidades o ON o.id = c.oportunidad_id
  WHERE c.codigo IS NULL OR c.codigo = ''
)
UPDATE cotizaciones
SET codigo = numbered.new_codigo
FROM numbered
WHERE cotizaciones.id = numbered.id;
