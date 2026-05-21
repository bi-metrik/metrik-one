-- ============================================================
-- FASE 1 — Roles · Areas · Stages: negocios.is_paused (flag ortogonal)
-- ============================================================
-- La pausa es ortogonal al stage. Un negocio en 'ejecucion' puede estar
-- pausado por el cliente sin perder su posicion.
--
-- Ya existe la columna legacy 'pausado' (bool) usada por SLA. La preservamos
-- y reutilizamos: is_paused es un alias canonico documentado en el modelo
-- nuevo. paused_at / paused_by / paused_reason son nuevos.
-- ============================================================

ALTER TABLE negocios
  ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE negocios
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

ALTER TABLE negocios
  ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE negocios
  ADD COLUMN IF NOT EXISTS paused_reason TEXT;

-- ============================================================
-- Backfill: sincronizar con la columna legacy `pausado`
-- ============================================================
UPDATE negocios
SET is_paused = pausado
WHERE pausado IS NOT NULL
  AND is_paused IS DISTINCT FROM pausado;

UPDATE negocios
SET paused_at = ultimo_pausado_at
WHERE is_paused = true
  AND paused_at IS NULL
  AND ultimo_pausado_at IS NOT NULL;

UPDATE negocios
SET paused_reason = COALESCE(motivo_pausa_detalle, motivo_pausa)
WHERE is_paused = true
  AND paused_reason IS NULL
  AND (motivo_pausa IS NOT NULL OR motivo_pausa_detalle IS NOT NULL);

-- ============================================================
-- Trigger: mantener `pausado` legacy sincronizado con is_paused
-- (durante Fase 2-6 hasta que la app deje de usar `pausado`)
-- ============================================================
CREATE OR REPLACE FUNCTION sync_negocios_pausa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sync ambos sentidos: si app legacy actualiza `pausado`, refleja en is_paused y viceversa
  IF NEW.is_paused IS DISTINCT FROM OLD.is_paused THEN
    NEW.pausado := NEW.is_paused;
    IF NEW.is_paused = true AND NEW.paused_at IS NULL THEN
      NEW.paused_at := NOW();
    END IF;
  ELSIF NEW.pausado IS DISTINCT FROM OLD.pausado THEN
    NEW.is_paused := NEW.pausado;
    IF NEW.pausado = true AND NEW.paused_at IS NULL THEN
      NEW.paused_at := NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_negocios_pausa ON negocios;
CREATE TRIGGER trg_sync_negocios_pausa
  BEFORE UPDATE OF is_paused, pausado ON negocios
  FOR EACH ROW
  EXECUTE FUNCTION sync_negocios_pausa();

COMMENT ON COLUMN negocios.is_paused IS
  'Pausa ortogonal al stage. Canon del modelo roles-areas-stages Fase 1. '
  'Sincronizada con columna legacy `pausado` via trigger hasta Fase 6.';
