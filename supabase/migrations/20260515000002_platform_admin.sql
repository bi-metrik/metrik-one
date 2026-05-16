-- ============================================================
-- 20260515000002_platform_admin
-- ============================================================
-- Patron "platform admin": staff MeTRIK puede saltar a cualquier workspace
-- via UI switcher para soporte/debugging, sin necesidad de credenciales
-- del cliente.
--
-- Cambia profile.workspace_id al target. Guarda home_workspace_id la primera
-- vez para poder regresar. Audit log de cada switch.
--
-- Spec: profiles tiene UNIQUE(id) — un usuario = un workspace en cualquier
-- momento. Este patron mantiene esa restriccion pero permite "moverse" entre
-- workspaces con audit trail.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS home_workspace_id UUID REFERENCES workspaces(id);

COMMENT ON COLUMN profiles.platform_admin IS
  'Si TRUE, puede saltar a cualquier workspace via switcher UI (sin credenciales del tenant). Reservado para staff MeTRIK';

COMMENT ON COLUMN profiles.home_workspace_id IS
  'Workspace original al que el platform admin vuelve cuando click "Regresar a home". Se setea automaticamente al primer switch';

-- Seed: Mauricio es platform admin
UPDATE profiles SET platform_admin = TRUE
WHERE id = (SELECT id FROM auth.users WHERE email = 'mauricio.moreno@metrik.com.co');
