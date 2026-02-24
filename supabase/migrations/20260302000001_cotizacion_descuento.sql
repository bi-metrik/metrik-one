-- Add discount fields to cotizaciones
-- Allows users to apply a percentage discount that appears in proposals

ALTER TABLE cotizaciones
  ADD COLUMN descuento_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN descuento_valor NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN cotizaciones.descuento_porcentaje IS 'Discount percentage (0-100)';
COMMENT ON COLUMN cotizaciones.descuento_valor IS 'Absolute discount amount (calculated from % × valor_total)';
