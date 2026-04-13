-- Retenciones fiscales en causación
-- Agrega soporte para múltiples retenciones (IVA, ReteIVA, ReteFuente, ReteICA)
-- y datos del tercero por movimiento

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS retenciones jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tercero_nit text,
  ADD COLUMN IF NOT EXISTS tercero_razon_social text;

ALTER TABLE cobros
  ADD COLUMN IF NOT EXISTS retenciones jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tercero_nit text,
  ADD COLUMN IF NOT EXISTS tercero_razon_social text;
