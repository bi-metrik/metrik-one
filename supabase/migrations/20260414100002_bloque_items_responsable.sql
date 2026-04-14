-- Agregar responsable_id a bloque_items para cronograma
ALTER TABLE bloque_items ADD COLUMN IF NOT EXISTS responsable_id UUID REFERENCES staff(id);
