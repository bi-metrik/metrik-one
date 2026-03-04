-- ============================================================
-- Migration: Add tipo_iva + tarifa_iva to servicios table
-- Spec: [98B] §2.8, D78, D80
-- Date: 2026-03-04
-- ============================================================

-- tipo_iva: classification per service (gravado_19, gravado_5, exento, excluido)
-- tarifa_iva: derived decimal (0.19, 0.05, 0, 0) — editable only for gravado types
ALTER TABLE servicios
  ADD COLUMN IF NOT EXISTS tipo_iva TEXT NOT NULL DEFAULT 'gravado_19'
    CHECK (tipo_iva IN ('gravado_19', 'gravado_5', 'exento', 'excluido')),
  ADD COLUMN IF NOT EXISTS tarifa_iva NUMERIC(5,4) NOT NULL DEFAULT 0.19;

-- Add costo_estimado if it doesn't exist (may already exist from prior migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'servicios' AND column_name = 'costo_estimado'
  ) THEN
    ALTER TABLE servicios ADD COLUMN costo_estimado NUMERIC(15,2);
  END IF;
END $$;

COMMENT ON COLUMN servicios.tipo_iva IS 'IVA classification: gravado_19, gravado_5, exento, excluido (D78)';
COMMENT ON COLUMN servicios.tarifa_iva IS 'IVA rate as decimal (0.19, 0.05, 0, 0). Derived from tipo_iva, editable for gravado types.';
