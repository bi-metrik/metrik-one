-- ============================================================
-- 20260518000001_flujo_sla_etapa_cambiada_at
-- ============================================================
-- Sesion 2026-05-18: habilitar vista /flujo cliente + SLA configurable por etapa
-- + refactor /admin/workflows a render live.
--
-- Cambios:
-- 1) etapas_negocio.config_extra.sla_dias: convencion de jsonb (no requiere ALTER).
--    Convencion: integer >= 0 = umbral en dias, null = sin alerta.
-- 2) negocios.etapa_cambiada_at: nueva columna timestamp + trigger.
-- 3) Vista v_negocios_etapa_vencimiento para conteo abiertos y vencidos.
-- 4) Indice (workspace_id, etapa_actual_id, estado).
-- 5) DROP tabla admin_workflows + bucket workflows (snapshots reemplazados por
--    render live desde etapas_negocio + bloque_configs).
-- ============================================================

-- ------------------------------------------------------------
-- 1. negocios.etapa_cambiada_at
-- ------------------------------------------------------------
ALTER TABLE public.negocios
  ADD COLUMN IF NOT EXISTS etapa_cambiada_at TIMESTAMPTZ;

COMMENT ON COLUMN public.negocios.etapa_cambiada_at IS
  'Timestamp del ultimo cambio de etapa_actual_id. Backfilled con created_at en migracion inicial. Actualizado por trigger.';

-- Backfill: copiar updated_at como inicial razonable. Decision: usamos updated_at
-- porque refleja la ultima actividad del negocio, mas representativo que created_at
-- para negocios que ya han recorrido el flujo. Para negocios nuevos sin cambios,
-- updated_at == created_at, asi que el efecto es el mismo.
UPDATE public.negocios
SET etapa_cambiada_at = COALESCE(updated_at, created_at)
WHERE etapa_cambiada_at IS NULL;

-- Trigger para mantener etapa_cambiada_at actualizado cuando cambia etapa_actual_id
CREATE OR REPLACE FUNCTION public.negocios_track_etapa_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo actualizar si etapa_actual_id realmente cambia
  IF (NEW.etapa_actual_id IS DISTINCT FROM OLD.etapa_actual_id) THEN
    NEW.etapa_cambiada_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_negocios_track_etapa_change ON public.negocios;
CREATE TRIGGER trg_negocios_track_etapa_change
  BEFORE UPDATE ON public.negocios
  FOR EACH ROW EXECUTE FUNCTION public.negocios_track_etapa_change();

-- Inicializar etapa_cambiada_at en NOW() al crear negocio (para INSERTs)
CREATE OR REPLACE FUNCTION public.negocios_init_etapa_cambiada_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.etapa_cambiada_at IS NULL THEN
    NEW.etapa_cambiada_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_negocios_init_etapa_cambiada_at ON public.negocios;
CREATE TRIGGER trg_negocios_init_etapa_cambiada_at
  BEFORE INSERT ON public.negocios
  FOR EACH ROW EXECUTE FUNCTION public.negocios_init_etapa_cambiada_at();

-- ------------------------------------------------------------
-- 2. Indice de performance para vista de vencimiento
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_negocios_workspace_etapa_estado
  ON public.negocios(workspace_id, etapa_actual_id, estado);

-- ------------------------------------------------------------
-- 3. Vista v_negocios_etapa_vencimiento
-- Por workspace_id + linea_id + etapa_id: count de abiertos + vencidos.
-- "Vencido" = now() - etapa_cambiada_at > sla_dias * INTERVAL '1 day'
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.v_negocios_etapa_vencimiento;
CREATE VIEW public.v_negocios_etapa_vencimiento AS
SELECT
  n.workspace_id,
  en.linea_id,
  en.id AS etapa_id,
  en.nombre AS etapa_nombre,
  en.orden AS etapa_orden,
  COALESCE((en.config_extra->>'sla_dias')::INTEGER, NULL) AS sla_dias,
  COUNT(n.id) FILTER (WHERE n.estado = 'abierto') AS abiertos,
  COUNT(n.id) FILTER (
    WHERE n.estado = 'abierto'
      AND (en.config_extra->>'sla_dias') IS NOT NULL
      AND (en.config_extra->>'sla_dias')::INTEGER > 0
      AND NOW() - n.etapa_cambiada_at > ((en.config_extra->>'sla_dias')::INTEGER * INTERVAL '1 day')
  ) AS vencidos
FROM public.etapas_negocio en
LEFT JOIN public.negocios n ON n.etapa_actual_id = en.id
GROUP BY n.workspace_id, en.linea_id, en.id, en.nombre, en.orden, en.config_extra;

COMMENT ON VIEW public.v_negocios_etapa_vencimiento IS
  'Conteo de negocios abiertos y vencidos por etapa. Vencido = ahora - etapa_cambiada_at > sla_dias.';

-- ------------------------------------------------------------
-- 4. DROP admin_workflows + bucket workflows + endpoint sync
-- Snapshots HTML reemplazados por render live desde DB.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_admin_workflows_updated_at ON public.admin_workflows;
DROP FUNCTION IF EXISTS public.admin_workflows_set_updated_at() CASCADE;
DROP TABLE IF EXISTS public.admin_workflows CASCADE;

-- NOTA: Bucket 'workflows' + sus objetos se eliminan via Storage API en post-migration
-- (PostgreSQL bloquea DELETE directo sobre storage.objects).
-- Ver scripts/cleanup-workflows-bucket.ts
