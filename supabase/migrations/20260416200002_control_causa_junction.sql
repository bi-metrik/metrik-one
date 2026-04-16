-- Control ↔ Causa: many-to-many junction table
-- Replaces direct riesgos_controles.causa_id (1:1) relationship

-- 1. Create junction table
CREATE TABLE control_causa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id UUID NOT NULL REFERENCES riesgos_controles(id) ON DELETE CASCADE,
  causa_id UUID NOT NULL REFERENCES riesgo_causas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(control_id, causa_id)
);

-- 2. Indexes
CREATE INDEX idx_control_causa_control ON control_causa(control_id);
CREATE INDEX idx_control_causa_causa ON control_causa(causa_id);

-- 3. RLS
ALTER TABLE control_causa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "control_causa_select" ON control_causa FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM riesgos_controles rc
    WHERE rc.id = control_causa.control_id
    AND rc.workspace_id = current_user_workspace_id()
  ));

CREATE POLICY "control_causa_insert" ON control_causa FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM riesgos_controles rc
    WHERE rc.id = control_causa.control_id
    AND rc.workspace_id = current_user_workspace_id()
  ));

CREATE POLICY "control_causa_delete" ON control_causa FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM riesgos_controles rc
    WHERE rc.id = control_causa.control_id
    AND rc.workspace_id = current_user_workspace_id()
  ));

-- 4. Migrate existing causa_id data to junction table
INSERT INTO control_causa (control_id, causa_id)
SELECT id, causa_id FROM riesgos_controles WHERE causa_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 5. Make riesgo_id nullable (controls are now workspace-level entities)
ALTER TABLE riesgos_controles ALTER COLUMN riesgo_id DROP NOT NULL;
