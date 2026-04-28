-- ============================================================
-- 20260427100003 — Flag revisado (reemplaza flujo causacion)
-- Bandeja de revision: marcar/desmarcar revisado por movimiento.
-- Sin formularios fiscales, sin retenciones JSONB, sin PUC/CC.
-- Spec: docs/specs/2026-04-26_mc-ebitda-capa-fiscal-simplificada.md §3 + §4
-- ============================================================

-- ── gastos ────────────────────────────────────────────────
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS revisado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revisado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revisado_por UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_gastos_revisado
  ON gastos(workspace_id, revisado, fecha DESC);

-- ── cobros ────────────────────────────────────────────────
ALTER TABLE cobros
  ADD COLUMN IF NOT EXISTS revisado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revisado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revisado_por UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_cobros_revisado
  ON cobros(workspace_id, revisado, fecha DESC);

COMMENT ON COLUMN gastos.revisado IS
  'Flag binario reemplaza flujo causacion. true = empresario o contador marco como revisado. Sin estados intermedios.';
COMMENT ON COLUMN cobros.revisado IS
  'Flag binario reemplaza flujo causacion. true = empresario o contador marco como revisado. Sin estados intermedios.';
