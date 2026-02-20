-- Mi Negocio: Capa Transversal v2
-- Adds columns for branding, extended fiscal profile, staff access types, and more

-- 1. workspaces: branding + equipo declarado
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS color_primario TEXT DEFAULT '#10B981';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS color_secundario TEXT DEFAULT '#1A1A1A';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS equipo_declarado INTEGER DEFAULT 1;

-- 2. fiscal_profiles: extended fields for invoicing
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS nit TEXT;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS direccion_fiscal TEXT;
ALTER TABLE fiscal_profiles ADD COLUMN IF NOT EXISTS email_facturacion TEXT;

-- 3. staff: access type, contract type, and available hours
ALTER TABLE staff ADD COLUMN IF NOT EXISTS tipo_acceso TEXT DEFAULT 'app'
  CHECK (tipo_acceso IN ('app', 'whatsapp', 'ambos', 'ninguno'));
ALTER TABLE staff ADD COLUMN IF NOT EXISTS tipo_vinculo TEXT
  CHECK (tipo_vinculo IN ('empleado', 'contratista', 'freelance'));
ALTER TABLE staff ADD COLUMN IF NOT EXISTS horas_disponibles_mes INTEGER DEFAULT 160;

-- 4. servicios: estimated cost for margin calculation
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS costo_estimado NUMERIC(15,2) DEFAULT 0;

-- 5. fixed_expenses: payment day and deductibility
ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS dia_pago INTEGER
  CHECK (dia_pago >= 1 AND dia_pago <= 31);
ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS deducible BOOLEAN DEFAULT false;
