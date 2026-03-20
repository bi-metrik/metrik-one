-- Extender CHECK constraint de team_invitations.role para incluir 'supervisor'
-- El sistema de roles [98G] agrego supervisor pero el constraint original solo tenia admin/operator/read_only

ALTER TABLE team_invitations DROP CONSTRAINT IF EXISTS team_invitations_role_check;
ALTER TABLE team_invitations ADD CONSTRAINT team_invitations_role_check
  CHECK (role IN ('owner', 'admin', 'supervisor', 'operator', 'read_only'));
