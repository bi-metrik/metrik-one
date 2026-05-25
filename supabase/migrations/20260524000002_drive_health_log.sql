-- ============================================================
-- 20260524000002 — Tabla drive_health_log + indices
--
-- Log de health checks diarios sobre Drive de cada workspace.
-- Registra acceso al folder padre configurado, identifica folders
-- muertos / tokens revocados ANTES de que un negocio falle al crearse.
--
-- Refs: cerebro/reglas/setup-drive-workspace-canonico.md
-- ============================================================

CREATE TABLE IF NOT EXISTS drive_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  oauth_mode TEXT NOT NULL CHECK (oauth_mode IN ('per_workspace', 'global', 'none')),
  drive_folder_id TEXT,
  folder_accessible BOOLEAN NOT NULL,
  folder_name TEXT,
  shared_drive_id TEXT,
  token_refresh_ok BOOLEAN NOT NULL,
  error_code TEXT,
  error_message TEXT,
  latency_ms INTEGER
);

ALTER TABLE drive_health_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY drive_health_log_ws ON drive_health_log
  FOR SELECT USING (workspace_id = current_user_workspace_id());

CREATE INDEX idx_drive_health_ws_checked ON drive_health_log(workspace_id, checked_at DESC);
CREATE INDEX idx_drive_health_failures ON drive_health_log(checked_at DESC)
  WHERE folder_accessible = false OR token_refresh_ok = false;

COMMENT ON TABLE drive_health_log IS
  'Health check diario por workspace del OAuth + acceso al drive_folder_id configurado. Una fila por workspace por dia. Detecta folders muertos / tokens revocados antes de que afecten produccion.';
