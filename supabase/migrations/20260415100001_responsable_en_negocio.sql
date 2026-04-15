-- Responsable asignado a un negocio (visible en header de etapa)
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS responsable_id UUID REFERENCES staff(id) ON DELETE SET NULL;
