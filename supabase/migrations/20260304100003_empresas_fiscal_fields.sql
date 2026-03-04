-- ============================================================
-- Migration: Add autorretenedor + estado_fiscal to empresas
-- Spec: [98B] §2.2, §6, D75, D89
-- Date: 2026-03-04
-- ============================================================

-- D75: autorretenedor is one of the 6 hard gate fiscal fields
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS autorretenedor BOOLEAN DEFAULT false;

-- D89: 3-level fiscal status (computed from 6 fields completeness)
-- pendiente = 0 fields, parcial = 1-5 fields, verificado = 6/6
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS estado_fiscal TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado_fiscal IN ('pendiente', 'parcial', 'verificado'));

COMMENT ON COLUMN empresas.autorretenedor IS 'Si true → clientes NO le practican retención (D75). Hard gate field.';
COMMENT ON COLUMN empresas.estado_fiscal IS 'Estado fiscal 3 niveles (D89): pendiente (0 campos), parcial (1-5), verificado (6/6).';

-- Backfill estado_fiscal for existing rows based on current data
UPDATE empresas SET estado_fiscal = CASE
  WHEN numero_documento IS NOT NULL
    AND tipo_persona IS NOT NULL
    AND regimen_tributario IS NOT NULL
    AND gran_contribuyente IS NOT NULL
    AND agente_retenedor IS NOT NULL
    AND autorretenedor IS NOT NULL
  THEN 'verificado'
  WHEN numero_documento IS NULL
    AND tipo_persona IS NULL
    AND regimen_tributario IS NULL
    AND gran_contribuyente IS NULL
    AND agente_retenedor IS NULL
  THEN 'pendiente'
  ELSE 'parcial'
END;

-- Update RPC to include autorretenedor in the 6-field check (D75)
CREATE OR REPLACE FUNCTION check_perfil_fiscal_completo(p_empresa_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM empresas
    WHERE id = p_empresa_id
      AND numero_documento IS NOT NULL
      AND tipo_persona IS NOT NULL
      AND regimen_tributario IS NOT NULL
      AND gran_contribuyente IS NOT NULL
      AND agente_retenedor IS NOT NULL
      AND autorretenedor IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql;
