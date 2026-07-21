-- ============================================================
-- 20260721000001 — metas_comerciales (metas de venta configurables)
-- ------------------------------------------------------------
-- Metas comerciales por mes para el tablero comercial sobre negocios
-- (get_comercial_kpis_mes_soena las lee para computar cumplimiento en vivo).
--
-- Grano: (workspace_id, staff_id NULLABLE, anio, mes).
--   - staff_id NULL  = META GLOBAL del equipo para ese mes.
--   - staff_id != NULL = meta de ese vendedor para ese mes.
-- Un upsert por (workspace, staff, anio, mes) via indice unico (NULLS NOT
-- DISTINCT para que la fila global no se duplique).
--
-- meta_num_ventas = # de propuestas aprobadas objetivo del mes.
-- meta_valor      = honorario (sin IVA) objetivo del mes, en COP.
--
-- Editable por owner/admin/supervisor (gate en la server action, misma puerta
-- que conciliacion). RLS: lectura authenticated del propio workspace; la
-- escritura tambien pasa por policy de workspace + el gate de rol en codigo.
--
-- Convencion CLAUDE.md: RLS on + policy por workspace + grant a authenticated.
-- Idempotente. Rollback comentado al final.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.metas_comerciales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  staff_id       uuid REFERENCES public.staff(id) ON DELETE CASCADE,  -- NULL = meta global
  anio           integer NOT NULL,
  mes            integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  meta_num_ventas integer,
  meta_valor     numeric,
  created_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Unico por (workspace, staff, anio, mes). NULLS NOT DISTINCT: la fila global
-- (staff_id NULL) es unica por (workspace, anio, mes) y no se duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_metas_comerciales_scope
  ON public.metas_comerciales (workspace_id, staff_id, anio, mes)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_metas_comerciales_ws_periodo
  ON public.metas_comerciales (workspace_id, anio, mes);

ALTER TABLE public.metas_comerciales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metas_comerciales_select ON public.metas_comerciales;
CREATE POLICY metas_comerciales_select ON public.metas_comerciales
  FOR SELECT TO authenticated
  USING (workspace_id = current_user_workspace_id());

DROP POLICY IF EXISTS metas_comerciales_insert ON public.metas_comerciales;
CREATE POLICY metas_comerciales_insert ON public.metas_comerciales
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = current_user_workspace_id());

DROP POLICY IF EXISTS metas_comerciales_update ON public.metas_comerciales;
CREATE POLICY metas_comerciales_update ON public.metas_comerciales
  FOR UPDATE TO authenticated
  USING (workspace_id = current_user_workspace_id())
  WITH CHECK (workspace_id = current_user_workspace_id());

DROP POLICY IF EXISTS metas_comerciales_delete ON public.metas_comerciales;
CREATE POLICY metas_comerciales_delete ON public.metas_comerciales
  FOR DELETE TO authenticated
  USING (workspace_id = current_user_workspace_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.metas_comerciales TO authenticated;

COMMENT ON TABLE public.metas_comerciales IS
  'Metas comerciales por mes (staff_id NULL = meta global del equipo). Alimenta el cumplimiento del tablero comercial. Editable por owner/admin/supervisor (gate en server action).';

-- ============================================================
-- ROLLBACK (comentado):
--   DROP TABLE IF EXISTS public.metas_comerciales;
-- ============================================================
