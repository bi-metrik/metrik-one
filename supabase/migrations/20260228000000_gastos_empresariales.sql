-- v2.2: Gastos empresariales (D101, D102, D105)

-- 1. Agregar columna tipo a gastos para clasificar directo/operativo/empresa/fijo
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'operativo'
  CHECK (tipo IN ('directo', 'operativo', 'empresa', 'fijo'));

-- 2. Marcar gastos existentes con proyecto como directos
UPDATE gastos SET tipo = 'directo' WHERE proyecto_id IS NOT NULL;

-- 3. D105: Anti-spam sugerencia automática de gasto fijo
ALTER TABLE gastos_fijos_config ADD COLUMN IF NOT EXISTS sugerencia_rechazada BOOLEAN DEFAULT false;
