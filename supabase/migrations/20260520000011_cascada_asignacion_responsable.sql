-- ============================================================
-- FASE 2 — Roles · Areas · Stages: cascada asignacion automatica
-- ============================================================
-- Cuando un negocio cambia su stage_actual a un stage operativo
-- (venta/ejecucion/cobro), el trigger asigna un responsable del area
-- entrante si:
--   - el negocio no tiene aun responsable de esa area (incluyendo direccion)
--   - existe un candidato unico segun la cascada
--
-- Cascada (en orden):
--   1. workspace_default_responsables[area]
--   2. operator UNICO del area (incluye direccion). Si hay 2+, NO asigna
--   3. supervisor UNICO del area (incluye direccion). Si hay 2+, NO asigna
--   4. admin UNICO del workspace. Si hay 2+, NO asigna
--   5. owner del workspace (siempre 1)
--
-- Cuando NO asigna automaticamente:
--   - cierre del stage_actual a 'cerrado' (no aplica cascada)
--   - stage no cambia (TG_OP UPDATE pero stage_actual igual)
--   - ya existe responsable del area (operator/supervisor/etc del area)
--   - 2+ candidatos en algun paso de la cascada y los siguientes pasos
--     tambien tienen 2+ -> queda sin asignar (alerta en cron Fase 2/7)
--
-- Notas:
--   - sync_negocio_stage_from_etapa (Fase 1) corre BEFORE UPDATE y
--     puede modificar stage_actual antes que este trigger AFTER UPDATE.
--     Por eso este se engancha a stage_actual directamente.
--   - assigned_by = NULL representa "SYSTEM" (no es FK a profiles humano).
-- ============================================================

CREATE OR REPLACE FUNCTION asignar_responsable_area_entrante()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_area_nueva TEXT;
  v_staff_id UUID;
  v_workspace UUID := NEW.workspace_id;
  v_n_candidatos INT;
BEGIN
  -- Solo dispara si cambia stage_actual a un stage operativo
  IF NEW.stage_actual IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.stage_actual = 'cerrado' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.stage_actual IS NOT DISTINCT FROM OLD.stage_actual THEN
    RETURN NEW;
  END IF;

  v_area_nueva := CASE NEW.stage_actual
    WHEN 'venta' THEN 'comercial'
    WHEN 'ejecucion' THEN 'operaciones'
    WHEN 'cobro' THEN 'financiera'
    ELSE NULL
  END;

  IF v_area_nueva IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── Si ya hay responsable del area (incluyendo direccion), salir ──
  IF EXISTS (
    SELECT 1
    FROM negocio_responsables nr
    JOIN staff_areas sa ON sa.staff_id = nr.staff_id
    WHERE nr.negocio_id = NEW.id
      AND sa.area IN (v_area_nueva, 'direccion')
  ) THEN
    RETURN NEW;
  END IF;

  -- ── Cascada paso 1: workspace_default_responsables ──
  SELECT staff_id INTO v_staff_id
  FROM workspace_default_responsables
  WHERE workspace_id = v_workspace
    AND area = v_area_nueva
  LIMIT 1;

  -- NOTA: staff no tiene columna `role`. El rol canonico vive en
  -- profiles.role (owner/admin/supervisor/operator/contador/read_only).
  -- Linkeamos via staff.profile_id = profiles.id.

  -- ── Cascada paso 2: operator UNICO del area (o direccion) ──
  IF v_staff_id IS NULL THEN
    SELECT COUNT(*) INTO v_n_candidatos
    FROM staff s
    JOIN profiles p ON p.id = s.profile_id
    WHERE s.workspace_id = v_workspace
      AND p.role = 'operator'
      AND EXISTS (
        SELECT 1 FROM staff_areas sa
        WHERE sa.staff_id = s.id
          AND sa.area IN (v_area_nueva, 'direccion')
      );

    IF v_n_candidatos = 1 THEN
      SELECT s.id INTO v_staff_id
      FROM staff s
      JOIN profiles p ON p.id = s.profile_id
      WHERE s.workspace_id = v_workspace
        AND p.role = 'operator'
        AND EXISTS (
          SELECT 1 FROM staff_areas sa
          WHERE sa.staff_id = s.id
            AND sa.area IN (v_area_nueva, 'direccion')
        );
    END IF;
  END IF;

  -- ── Cascada paso 3: supervisor UNICO del area (o direccion) ──
  IF v_staff_id IS NULL THEN
    SELECT COUNT(*) INTO v_n_candidatos
    FROM staff s
    JOIN profiles p ON p.id = s.profile_id
    WHERE s.workspace_id = v_workspace
      AND p.role = 'supervisor'
      AND EXISTS (
        SELECT 1 FROM staff_areas sa
        WHERE sa.staff_id = s.id
          AND sa.area IN (v_area_nueva, 'direccion')
      );

    IF v_n_candidatos = 1 THEN
      SELECT s.id INTO v_staff_id
      FROM staff s
      JOIN profiles p ON p.id = s.profile_id
      WHERE s.workspace_id = v_workspace
        AND p.role = 'supervisor'
        AND EXISTS (
          SELECT 1 FROM staff_areas sa
          WHERE sa.staff_id = s.id
            AND sa.area IN (v_area_nueva, 'direccion')
        );
    END IF;
  END IF;

  -- ── Cascada paso 4: admin UNICO del workspace ──
  IF v_staff_id IS NULL THEN
    SELECT COUNT(*) INTO v_n_candidatos
    FROM staff s
    JOIN profiles p ON p.id = s.profile_id
    WHERE s.workspace_id = v_workspace
      AND p.role = 'admin';

    IF v_n_candidatos = 1 THEN
      SELECT s.id INTO v_staff_id
      FROM staff s
      JOIN profiles p ON p.id = s.profile_id
      WHERE s.workspace_id = v_workspace
        AND p.role = 'admin'
      LIMIT 1;
    END IF;
  END IF;

  -- ── Cascada paso 5: owner del workspace (siempre 1) ──
  IF v_staff_id IS NULL THEN
    SELECT s.id INTO v_staff_id
    FROM staff s
    JOIN profiles p ON p.id = s.profile_id
    WHERE s.workspace_id = v_workspace
      AND p.role = 'owner'
    LIMIT 1;
  END IF;

  -- ── Insertar si tenemos candidato ──
  IF v_staff_id IS NOT NULL THEN
    INSERT INTO negocio_responsables (negocio_id, staff_id, assigned_at, assigned_by)
    VALUES (NEW.id, v_staff_id, NOW(), NULL)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Si v_staff_id es NULL (no hay candidato unico), no se asigna.
  -- Cron de alerta (mas abajo) lo detecta y notifica.

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_responsable_area_entrante ON negocios;
CREATE TRIGGER trg_asignar_responsable_area_entrante
  AFTER UPDATE OF stage_actual ON negocios
  FOR EACH ROW
  EXECUTE FUNCTION asignar_responsable_area_entrante();

COMMENT ON FUNCTION asignar_responsable_area_entrante() IS
  'Cascada de asignacion automatica de responsable del area entrante '
  'cuando el negocio transiciona de stage. Solo asigna si hay candidato '
  'unico en algun paso de la cascada. Modelo roles-areas-stages Fase 2.';


-- ============================================================
-- Sync denormalizado: negocios.responsable_id <-> primer registro
-- en negocio_responsables (orden por assigned_at ASC).
-- Conserva la columna scalar como "responsable principal" para no
-- romper consumidores legacy. Se actualiza tras INSERT/DELETE en
-- negocio_responsables.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_negocio_responsable_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id UUID;
  v_first_staff UUID;
BEGIN
  v_negocio_id := COALESCE(NEW.negocio_id, OLD.negocio_id);

  SELECT staff_id INTO v_first_staff
  FROM negocio_responsables
  WHERE negocio_id = v_negocio_id
  ORDER BY assigned_at ASC NULLS LAST
  LIMIT 1;

  UPDATE negocios
  SET responsable_id = v_first_staff
  WHERE id = v_negocio_id
    AND responsable_id IS DISTINCT FROM v_first_staff;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_negocio_responsable_id_ins ON negocio_responsables;
CREATE TRIGGER trg_sync_negocio_responsable_id_ins
  AFTER INSERT ON negocio_responsables
  FOR EACH ROW
  EXECUTE FUNCTION sync_negocio_responsable_id();

DROP TRIGGER IF EXISTS trg_sync_negocio_responsable_id_del ON negocio_responsables;
CREATE TRIGGER trg_sync_negocio_responsable_id_del
  AFTER DELETE ON negocio_responsables
  FOR EACH ROW
  EXECUTE FUNCTION sync_negocio_responsable_id();

COMMENT ON FUNCTION sync_negocio_responsable_id() IS
  'Sincroniza negocios.responsable_id (denormalizado) con el primer '
  'registro de negocio_responsables ordenado por assigned_at ASC. '
  'Modelo roles-areas-stages Fase 2 - DEPRECATED columna se elimina en Fase 6.';
