-- [98G] Licencias: max_seats en workspaces
-- Default 1 (licencia base incluye 1 usuario). Se aumenta manualmente por ahora.

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS max_seats INTEGER DEFAULT 1 NOT NULL;

COMMENT ON COLUMN workspaces.max_seats IS 'Numero maximo de usuarios con acceso a la plataforma (licencias). Default 1 = plan base.';
