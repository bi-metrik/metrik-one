-- Increase workspace slug limit from 20 to 48 characters
-- Fixes truncation of long business names (e.g. "Estudio Creativo Lumina" → was "estudio-creativo-lum")

CREATE OR REPLACE FUNCTION generate_workspace_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  base_slug := NEW.name;
  base_slug := lower(base_slug);
  base_slug := regexp_replace(base_slug, '\s*(s\.?a\.?s\.?|ltda\.?|s\.?a\.?|e\.?u\.?)\s*$', '', 'i');
  base_slug := translate(base_slug, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN');
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  base_slug := left(base_slug, 48);
  base_slug := trim(both '-' from base_slug);

  IF length(base_slug) < 3 THEN
    base_slug := base_slug || '-ws';
  END IF;

  final_slug := base_slug;

  WHILE final_slug IN ('www', 'api', 'admin', 'app', 'test', 'demo', 'staging', 'mail', 'ftp')
        OR EXISTS (SELECT 1 FROM workspaces WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := left(base_slug, 45) || '-' || counter;
  END LOOP;

  NEW.slug := final_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
