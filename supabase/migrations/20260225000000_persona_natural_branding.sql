-- Persona Natural: contacto_id FK + tipo_documento + rename nit
-- Dynamic Branding: already has color_primario/color_secundario from previous migration

-- 1. Add contacto_id FK to empresas (links persona natural to their contacto)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS contacto_id UUID REFERENCES contactos(id);

-- 2. Add tipo_documento column
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tipo_documento TEXT
  CHECK (tipo_documento IN ('CC','CE','NIT','pasaporte','PEP'));

-- 3. Rename nit -> numero_documento
ALTER TABLE empresas RENAME COLUMN nit TO numero_documento;

-- 4. Backfill: existing rows with numero_documento get tipo_documento = 'NIT'
UPDATE empresas SET tipo_documento = 'NIT'
  WHERE numero_documento IS NOT NULL AND tipo_documento IS NULL;

-- 5. Update check_perfil_fiscal_completo to use new column names
CREATE OR REPLACE FUNCTION check_perfil_fiscal_completo(p_empresa_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM empresas
    WHERE id = p_empresa_id
      AND numero_documento IS NOT NULL
      AND tipo_documento IS NOT NULL
      AND tipo_persona IS NOT NULL
      AND regimen_tributario IS NOT NULL
      AND gran_contribuyente IS NOT NULL
      AND agente_retenedor IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql;
