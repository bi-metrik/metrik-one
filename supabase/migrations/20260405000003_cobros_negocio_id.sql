-- ============================================================
-- Agrega negocio_id a cobros para vincular pagos a negocios
-- ============================================================

ALTER TABLE cobros ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES negocios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cobros_negocio ON cobros(negocio_id);
