-- Agrega negocio_id a gastos para vincular gastos directamente a negocios
-- (complementa proyecto_id, que sigue existiendo para proyectos legacy)

ALTER TABLE gastos ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES negocios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gastos_negocio ON gastos(negocio_id);
