-- cotizaciones.oportunidad_id → nullable (cotizaciones de negocios no tienen oportunidad)
ALTER TABLE cotizaciones ALTER COLUMN oportunidad_id DROP NOT NULL;

-- Agregar negocio_id FK
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES negocios(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_cotizaciones_negocio ON cotizaciones(negocio_id);
