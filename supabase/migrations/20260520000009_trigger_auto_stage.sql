-- ============================================================
-- FASE 1 — Roles · Areas · Stages: trigger auto-stage en negocios
-- ============================================================
-- Cuando un negocio cambia de etapa (etapa_actual_id), el trigger
-- recalcula stage_actual a partir del stage de la nueva etapa.
--
-- Si la nueva etapa pertenece a otro stage que el anterior, sincroniza
-- negocios.stage_actual. Esto cubre tanto avance normal (etapa siguiente
-- en otro stage) como cambios laterales / saltos.
--
-- Adicionalmente, si la nueva etapa.stage = 'cerrado' y el negocio no
-- tiene cierre_motivo, se asigna 'exitoso' por default (consistente con
-- el backfill de la migracion 20260520000003).
-- ============================================================

CREATE OR REPLACE FUNCTION sync_negocio_stage_from_etapa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_destino TEXT;
BEGIN
  -- Solo dispara cuando cambia la etapa
  IF NEW.etapa_actual_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.etapa_actual_id IS NOT DISTINCT FROM OLD.etapa_actual_id THEN
    RETURN NEW;
  END IF;

  -- Leer stage destino desde etapas_negocio
  SELECT stage INTO v_stage_destino
  FROM etapas_negocio
  WHERE id = NEW.etapa_actual_id;

  IF v_stage_destino IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sincronizar stage_actual si difiere
  IF NEW.stage_actual IS DISTINCT FROM v_stage_destino THEN
    NEW.stage_actual := v_stage_destino;
  END IF;

  -- Si destino es cerrado y no hay cierre_motivo, default exitoso
  IF v_stage_destino = 'cerrado' AND NEW.cierre_motivo IS NULL THEN
    NEW.cierre_motivo := 'exitoso';
  END IF;

  -- Si destino NO es cerrado, limpiar cierre_motivo
  IF v_stage_destino <> 'cerrado' AND NEW.cierre_motivo IS NOT NULL THEN
    NEW.cierre_motivo := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_negocio_stage_from_etapa ON negocios;
CREATE TRIGGER trg_sync_negocio_stage_from_etapa
  BEFORE INSERT OR UPDATE OF etapa_actual_id ON negocios
  FOR EACH ROW
  EXECUTE FUNCTION sync_negocio_stage_from_etapa();

COMMENT ON FUNCTION sync_negocio_stage_from_etapa() IS
  'Mantiene negocios.stage_actual coherente con el stage de la etapa actual. '
  'Setea/limpia cierre_motivo segun corresponde. '
  'Modelo roles-areas-stages Fase 1 (2026-05-20).';
