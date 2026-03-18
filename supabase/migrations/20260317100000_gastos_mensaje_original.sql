-- Guardar mensaje original de WhatsApp como metadata del gasto
-- Permite trazar exactamente qué dijo el usuario al registrar

ALTER TABLE gastos ADD COLUMN IF NOT EXISTS mensaje_original TEXT;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS mensaje_original TEXT;
ALTER TABLE horas ADD COLUMN IF NOT EXISTS mensaje_original TEXT;
