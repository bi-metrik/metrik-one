-- ============================================================
-- FASE 1 — Roles · Areas · Stages: workspace_default_responsables
-- ============================================================
-- Permite definir, por workspace y por area, cual staff es el responsable
-- por defecto cuando un negocio entra en un stage gobernado por esa area.
--
-- Casos canonicos:
--   comercial    -> responsable default cuando stage=venta
--   operaciones  -> responsable default cuando stage=ejecucion
--   financiera   -> responsable default cuando stage=cobro
--
-- Vacia al crear. Se llena via UI en Fase 3.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_default_responsables (
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  area           TEXT NOT NULL CHECK (area IN ('comercial', 'operaciones', 'financiera')),
  staff_id       UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  configured_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, area)
);

CREATE INDEX IF NOT EXISTS idx_workspace_default_responsables_staff
  ON workspace_default_responsables(staff_id);

-- RLS
ALTER TABLE workspace_default_responsables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wsdr_read" ON workspace_default_responsables
  FOR SELECT USING (workspace_id = current_user_workspace_id());

CREATE POLICY "wsdr_write" ON workspace_default_responsables
  FOR ALL USING (workspace_id = current_user_workspace_id())
  WITH CHECK (workspace_id = current_user_workspace_id());

COMMENT ON TABLE workspace_default_responsables IS
  'Responsable por defecto por workspace y area. '
  'Modelo roles-areas-stages Fase 1 (2026-05-20). Se llena via UI en Fase 3.';
