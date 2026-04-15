-- Cantidad por item (default 1 para compatibilidad)
ALTER TABLE items ADD COLUMN IF NOT EXISTS cantidad NUMERIC(10,2) DEFAULT 1 NOT NULL;

-- AIU manual en cotizaciones
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS aiu_admin_pct NUMERIC DEFAULT NULL;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS aiu_imprevistos_pct NUMERIC DEFAULT NULL;
