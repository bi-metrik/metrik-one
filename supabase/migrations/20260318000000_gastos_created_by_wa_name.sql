-- Guardar nombre del usuario de WhatsApp que registró el movimiento
-- Necesario porque staff/collaborators no tienen user_id en auth.users

ALTER TABLE gastos ADD COLUMN IF NOT EXISTS created_by_wa_name TEXT;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS created_by_wa_name TEXT;
ALTER TABLE horas ADD COLUMN IF NOT EXISTS created_by_wa_name TEXT;
