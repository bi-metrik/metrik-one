-- [98G] Fase 1: Data migration + trigger de sincronizacion

-- ─── 1a. Crear staff para profiles que no tienen uno ─────────────────────────

INSERT INTO staff (workspace_id, full_name, profile_id, rol_plataforma, area, is_active)
SELECT p.workspace_id, COALESCE(p.full_name, 'Usuario'), p.id,
  CASE p.role
    WHEN 'owner' THEN 'dueno'
    WHEN 'admin' THEN 'administrador'
    ELSE 'ejecutor'
  END,
  CASE p.role
    WHEN 'owner' THEN 'direccion'
    WHEN 'admin' THEN 'direccion'
    ELSE NULL
  END,
  true
FROM profiles p
WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.profile_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.workspace_id = p.workspace_id AND s.full_name = p.full_name);

-- ─── 1b. Linkear staff existentes que coinciden por nombre ───────────────────

UPDATE staff s SET
  profile_id = p.id,
  rol_plataforma = CASE p.role
    WHEN 'owner' THEN 'dueno'
    WHEN 'admin' THEN 'administrador'
    ELSE 'ejecutor'
  END
FROM profiles p
WHERE s.workspace_id = p.workspace_id
  AND s.full_name = p.full_name
  AND s.profile_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM staff s2 WHERE s2.profile_id = p.id);

-- ─── 1c. Trigger de sincronizacion staff.rol_plataforma → profiles.role ─────

CREATE OR REPLACE FUNCTION fn_sync_staff_role_to_profile()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.profile_id IS NOT NULL AND OLD.rol_plataforma IS DISTINCT FROM NEW.rol_plataforma THEN
    UPDATE profiles SET role = CASE NEW.rol_plataforma
      WHEN 'dueno' THEN 'owner'
      WHEN 'administrador' THEN 'admin'
      WHEN 'supervisor' THEN 'supervisor'
      WHEN 'ejecutor' THEN 'operator'
      WHEN 'campo' THEN 'read_only'
    END, updated_at = NOW()
    WHERE id = NEW.profile_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_staff_role ON staff;

CREATE TRIGGER trg_sync_staff_role
  AFTER INSERT OR UPDATE OF rol_plataforma ON staff
  FOR EACH ROW
  WHEN (NEW.profile_id IS NOT NULL)
  EXECUTE FUNCTION fn_sync_staff_role_to_profile();
