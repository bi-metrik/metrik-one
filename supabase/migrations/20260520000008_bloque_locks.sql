-- ============================================================
-- FASE 1 — Roles · Areas · Stages: tabla bloque_locks
-- ============================================================
-- Locks pesimistas sobre instancias de bloque (negocio_bloques).
-- En Fase 1 solo se crea la tabla, sin cron de cleanup. La implementacion
-- completa (cleanup, claim, release, retry) llega en Fase 5.
-- ============================================================

CREATE TABLE IF NOT EXISTS bloque_locks (
  bloque_instancia_id  UUID PRIMARY KEY REFERENCES negocio_bloques(id) ON DELETE CASCADE,
  locked_by            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  locked_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL,
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bloque_locks_expires_at
  ON bloque_locks(expires_at);

CREATE INDEX IF NOT EXISTS idx_bloque_locks_workspace
  ON bloque_locks(workspace_id);

CREATE INDEX IF NOT EXISTS idx_bloque_locks_locked_by
  ON bloque_locks(locked_by);

-- RLS
ALTER TABLE bloque_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bloque_locks_read" ON bloque_locks
  FOR SELECT USING (workspace_id = current_user_workspace_id());

CREATE POLICY "bloque_locks_write" ON bloque_locks
  FOR ALL USING (workspace_id = current_user_workspace_id())
  WITH CHECK (workspace_id = current_user_workspace_id());

COMMENT ON TABLE bloque_locks IS
  'Locks pesimistas sobre negocio_bloques. Una fila por bloque bloqueado. '
  'Fase 1: solo tabla. Fase 5: claim/release/cleanup completo. '
  'Modelo roles-areas-stages (2026-05-20).';
