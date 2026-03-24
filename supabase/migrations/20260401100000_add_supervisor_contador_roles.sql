-- Agregar roles supervisor (5) y contador (6) al sistema
-- supervisor: coordina equipo, ve todo el trabajo (sin causacion ni config)
-- contador: acceso exclusivo al modulo de causacion
-- area en profiles: afecta routing de N1 (comercial) y N7 (operaciones)

-- ─── 1. Actualizar CHECK de profiles.role ────────────────────────────────────

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'admin', 'supervisor', 'operator', 'contador', 'read_only'));

-- ─── 2. Agregar columnas area y display_role a profiles ──────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS area TEXT
  CHECK (area IN ('comercial', 'operaciones', 'administrativo', null));

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_role TEXT;

COMMENT ON COLUMN profiles.area IS 'Area funcional del usuario. Afecta routing de notificaciones N1 (comercial) y N7 (operaciones) para supervisores. No afecta permisos.';
COMMENT ON COLUMN profiles.display_role IS 'Nombre de rol personalizado para mostrar en UI. Ej: Supervisor Comercial, Jefe de Obra.';

-- ─── 3. Actualizar CHECK de team_invitations.role ────────────────────────────

ALTER TABLE team_invitations DROP CONSTRAINT IF EXISTS team_invitations_role_check;
ALTER TABLE team_invitations ADD CONSTRAINT team_invitations_role_check
  CHECK (role IN ('owner', 'admin', 'supervisor', 'operator', 'contador', 'read_only'));

-- ─── 4. Extender staff con display_role ──────────────────────────────────────

ALTER TABLE staff ADD COLUMN IF NOT EXISTS display_role TEXT;
COMMENT ON COLUMN staff.display_role IS 'Nombre de rol personalizado. Se copia a profiles.display_role al aceptar la invitacion.';

-- ─── 5. Extender rol_plataforma de staff para incluir contador ────────────────

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_rol_plataforma_check;
ALTER TABLE staff ADD CONSTRAINT staff_rol_plataforma_check
  CHECK (rol_plataforma IN ('dueno','administrador','supervisor','ejecutor','contador','campo'));

-- ─── 6. Indices ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_role_area ON profiles(workspace_id, role, area);
