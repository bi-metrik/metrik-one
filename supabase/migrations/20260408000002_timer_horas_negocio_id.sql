-- Add negocio_id to timer_activo and horas tables
-- Make proyecto_id nullable in both (negocios replaces proyectos as primary entity)

-- timer_activo: add negocio_id, make proyecto_id nullable
ALTER TABLE timer_activo ALTER COLUMN proyecto_id DROP NOT NULL;
ALTER TABLE timer_activo ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES negocios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_timer_activo_negocio ON timer_activo(negocio_id);

-- Add check: at least one of proyecto_id or negocio_id must be set
ALTER TABLE timer_activo ADD CONSTRAINT timer_activo_destino_check
  CHECK (proyecto_id IS NOT NULL OR negocio_id IS NOT NULL);

-- horas: add negocio_id, make proyecto_id nullable
ALTER TABLE horas ALTER COLUMN proyecto_id DROP NOT NULL;
ALTER TABLE horas ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES negocios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_horas_negocio ON horas(negocio_id);

-- Add check: at least one of proyecto_id or negocio_id must be set
ALTER TABLE horas ADD CONSTRAINT horas_destino_check
  CHECK (proyecto_id IS NOT NULL OR negocio_id IS NOT NULL);
