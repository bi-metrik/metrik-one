-- ============================================================
-- 20260524000001 — Trigger protect_workspace_config_extra
--
-- Contexto: workspace SOENA quedo con config_extra={} despues de tener
-- la triple drive_refresh_token + drive_client_id + drive_client_secret
-- configurada manualmente. Causa raiz: UPDATE plano de config_extra desde
-- SQL ad-hoc o script no canonico borro las keys drive_*.
--
-- Defensa: BEFORE UPDATE en workspaces. Si el nuevo config_extra borra
-- alguna key drive_* que existia antes -> RAISE EXCEPTION con guia clara.
--
-- Escape: el script canonico (setup-drive-workspace.ts) o scripts de
-- mantenimiento legitimos pueden bypass via session var
--   SET LOCAL app.allow_drive_reset = 'true';
-- antes del UPDATE en la misma transaccion.
--
-- Refs:
--  - cerebro/errores/config-extra-drive-borrado-silencioso.md
--  - cerebro/reglas/setup-drive-workspace-canonico.md
-- ============================================================

CREATE OR REPLACE FUNCTION protect_workspace_drive_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_has_drive boolean;
  v_new_has_drive boolean;
  v_old_keys jsonb;
  v_new_keys jsonb;
  v_lost_keys text[];
  v_allow_reset boolean;
BEGIN
  -- Solo evalua si config_extra cambia
  IF OLD.config_extra IS NOT DISTINCT FROM NEW.config_extra THEN
    RETURN NEW;
  END IF;

  -- Opt-in escape via session var
  BEGIN
    v_allow_reset := current_setting('app.allow_drive_reset', true)::boolean;
  EXCEPTION WHEN OTHERS THEN
    v_allow_reset := false;
  END;
  IF v_allow_reset THEN
    RETURN NEW;
  END IF;

  v_old_has_drive := (OLD.config_extra ? 'drive_refresh_token')
                  OR (OLD.config_extra ? 'drive_client_id')
                  OR (OLD.config_extra ? 'drive_client_secret');

  -- Si nunca tuvo drive_*, nada que proteger
  IF NOT v_old_has_drive THEN
    RETURN NEW;
  END IF;

  v_new_has_drive := (NEW.config_extra ? 'drive_refresh_token')
                  AND (NEW.config_extra ? 'drive_client_id')
                  AND (NEW.config_extra ? 'drive_client_secret');

  -- Si las tres claves siguen presentes en el nuevo, esta bien
  IF v_new_has_drive THEN
    RETURN NEW;
  END IF;

  -- Detectar exactamente que se perdio
  v_lost_keys := ARRAY[]::text[];
  IF (OLD.config_extra ? 'drive_refresh_token')
     AND NOT (NEW.config_extra ? 'drive_refresh_token') THEN
    v_lost_keys := array_append(v_lost_keys, 'drive_refresh_token');
  END IF;
  IF (OLD.config_extra ? 'drive_client_id')
     AND NOT (NEW.config_extra ? 'drive_client_id') THEN
    v_lost_keys := array_append(v_lost_keys, 'drive_client_id');
  END IF;
  IF (OLD.config_extra ? 'drive_client_secret')
     AND NOT (NEW.config_extra ? 'drive_client_secret') THEN
    v_lost_keys := array_append(v_lost_keys, 'drive_client_secret');
  END IF;

  RAISE EXCEPTION
    'UPDATE bloqueado: workspace % (slug=%) perderia keys drive_* (%) de config_extra. Usa scripts/setup-drive-workspace.ts para modificar credenciales Drive, o ejecuta SET LOCAL app.allow_drive_reset = ''true'' antes del UPDATE si el reset es intencional.',
    OLD.id, OLD.slug, array_to_string(v_lost_keys, ', ')
    USING ERRCODE = 'check_violation',
          HINT = 'Detalle en cerebro/reglas/setup-drive-workspace-canonico.md';
END;
$$;

DROP TRIGGER IF EXISTS protect_workspace_drive_config_trigger ON workspaces;
CREATE TRIGGER protect_workspace_drive_config_trigger
  BEFORE UPDATE ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION protect_workspace_drive_config();

COMMENT ON FUNCTION protect_workspace_drive_config IS
  'Bloquea UPDATEs que borran las keys drive_refresh_token, drive_client_id o drive_client_secret de workspaces.config_extra cuando ya estaban presentes. Escape: SET LOCAL app.allow_drive_reset = ''true''. Detalle en cerebro/reglas/setup-drive-workspace-canonico.md';
