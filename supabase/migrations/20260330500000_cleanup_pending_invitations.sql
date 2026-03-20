-- Limpiar invitaciones pendientes que quedaron de pruebas fallidas
UPDATE team_invitations SET status = 'expired' WHERE status = 'pending';
