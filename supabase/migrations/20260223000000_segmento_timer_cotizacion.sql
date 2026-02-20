-- ═══════════════════════════════════════════════════════
-- Migration: Segmento contactos + Timer horas + Cotización auto-ganar
-- ═══════════════════════════════════════════════════════

-- ── 1. Segmento en contactos ─────────────────────────
ALTER TABLE contactos ADD COLUMN IF NOT EXISTS segmento TEXT
  DEFAULT 'sin_contactar'
  CHECK (segmento IN ('sin_contactar', 'contactado', 'convertido', 'inactivo'));

CREATE INDEX IF NOT EXISTS idx_contactos_segmento ON contactos(workspace_id, segmento);

-- ── 2. Timer columns en horas ────────────────────────
-- Para tracking start/stop del cronómetro
ALTER TABLE horas ADD COLUMN IF NOT EXISTS inicio TIMESTAMPTZ;
ALTER TABLE horas ADD COLUMN IF NOT EXISTS fin TIMESTAMPTZ;
ALTER TABLE horas ADD COLUMN IF NOT EXISTS timer_activo BOOLEAN DEFAULT false;

-- ── 3. Timer state per workspace (active timer singleton) ─
CREATE TABLE IF NOT EXISTS timer_activo (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  proyecto_id UUID NOT NULL REFERENCES proyectos(id),
  inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  descripcion TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id)  -- solo 1 timer activo por workspace
);

ALTER TABLE timer_activo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "timer_activo_ws" ON timer_activo
  FOR ALL USING (workspace_id = current_user_workspace_id());
