-- Agregar columnas fecha_inicio y fecha_fin a bloque_items para BloqueCronograma
ALTER TABLE bloque_items ADD COLUMN IF NOT EXISTS fecha_inicio DATE;
ALTER TABLE bloque_items ADD COLUMN IF NOT EXISTS fecha_fin DATE;
