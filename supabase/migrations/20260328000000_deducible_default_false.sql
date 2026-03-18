-- Deducible debe ser false por defecto.
-- El contador lo activa en causación, no el usuario al registrar.
ALTER TABLE gastos ALTER COLUMN deducible SET DEFAULT false;

-- Corregir gastos de WhatsApp que quedaron con deducible=true sin revisión
UPDATE gastos
SET deducible = false
WHERE canal_registro = 'whatsapp'
  AND deducible = true
  AND estado_causacion IN ('PENDIENTE', 'APROBADO');
