-- [98G] workspace_features: track de add-ons activos por workspace
-- Feature keys: 'whatsapp', 'ai_bot', futuras features $80K c/u

CREATE TABLE IF NOT EXISTS workspace_features (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  activated_at TIMESTAMPTZ DEFAULT NOW(),
  price_cop INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_features_ws ON workspace_features(workspace_id);

ALTER TABLE workspace_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_features_workspace_isolation" ON workspace_features
  FOR ALL USING (workspace_id = current_user_workspace_id());

COMMENT ON TABLE workspace_features IS 'Add-ons activos por workspace. feature_key libre para nuevos add-ons sin migracion.';

-- Dimpro: activar WhatsApp + asignar 3 licencias (1 base + 2 adicionales)
UPDATE workspaces SET max_seats = 3 WHERE slug = 'dimpro';

INSERT INTO workspace_features (workspace_id, feature_key, is_active, price_cop)
SELECT id, 'whatsapp', true, 80000
FROM workspaces WHERE slug = 'dimpro'
ON CONFLICT (workspace_id, feature_key) DO NOTHING;
