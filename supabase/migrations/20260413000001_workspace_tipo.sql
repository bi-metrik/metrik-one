-- Distinguir workspaces nativos (ONE self-service) de Clarity (personalizados por MéTRIK)
-- nativo: usa plantillas globales, selecciona flujo en Mi Negocio
-- clarity: usa líneas custom configuradas por MéTRIK, selecciona flujo al crear negocio

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'nativo'
  CHECK (tipo IN ('nativo', 'clarity'));

COMMENT ON COLUMN workspaces.tipo IS 'nativo = ONE self-service con plantillas estándar. clarity = personalizado por MéTRIK con líneas custom.';
