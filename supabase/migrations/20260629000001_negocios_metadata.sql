-- Columna metadata genérica en negocios: llave estable para cruzar un negocio con
-- fuentes externas (ej. Id Hubspot del sheet de SOENA) y enriquecer en cargues
-- masivos sin re-auditar. Aditiva, nullable default '{}'. RLS/grant de negocios ya
-- cubren. Aplicada a prod vía MCP el 2026-06-29.
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN negocios.metadata IS 'Metadata libre. Cargues masivos: { id_hubspot, fuente_cargue } — llave estable para cruzar con fuentes externas (sheet) y enriquecer sin re-auditar.';
