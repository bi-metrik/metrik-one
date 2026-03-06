-- Add RUT OCR fields to fiscal_profiles (mi-negocio)
-- Mirrors the fields already present in empresas table from RUT extraction

-- Identity fields not yet in fiscal_profiles
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS tipo_documento TEXT;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS municipio TEXT;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS departamento TEXT;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS email_fiscal TEXT;

-- Fiscal boolean flags
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS gran_contribuyente BOOLEAN;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS agente_retenedor BOOLEAN;

-- Activity / dates
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS actividad_secundaria TEXT;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS fecha_inicio_actividades DATE;

-- RUT document metadata
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS rut_documento_url TEXT;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS rut_fecha_carga TIMESTAMPTZ;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS rut_confianza_ocr REAL;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS rut_verificado BOOLEAN DEFAULT false;
