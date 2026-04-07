-- ============================================================
-- cobros.proyecto_id → nullable
-- Cobros de negocios VE no tienen proyecto asociado
-- ============================================================

ALTER TABLE cobros ALTER COLUMN proyecto_id DROP NOT NULL;
