-- Align proyecto_rubros.tipo with cotización rubros types (§4.6)
-- Old types: horas, materiales, transporte, subcontratacion, servicios_profesionales, general
-- New types: mo_propia, mo_terceros, materiales, viaticos, software, servicios_prof, general

-- 1. Drop old CHECK constraint
ALTER TABLE proyecto_rubros DROP CONSTRAINT IF EXISTS proyecto_rubros_tipo_check;

-- 2. Migrate existing data to new types
UPDATE proyecto_rubros SET tipo = 'mo_propia' WHERE tipo = 'horas';
UPDATE proyecto_rubros SET tipo = 'servicios_prof' WHERE tipo = 'servicios_profesionales';
UPDATE proyecto_rubros SET tipo = 'viaticos' WHERE tipo = 'transporte';
UPDATE proyecto_rubros SET tipo = 'servicios_prof' WHERE tipo = 'subcontratacion';

-- 3. Add new CHECK constraint matching cotización rubros
ALTER TABLE proyecto_rubros ADD CONSTRAINT proyecto_rubros_tipo_check
  CHECK (tipo IN ('mo_propia', 'mo_terceros', 'materiales', 'viaticos', 'software', 'servicios_prof', 'general'));
