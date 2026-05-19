-- ============================================================
-- 20260519000002_etapa_sla_log
-- ============================================================
-- Tabla de auditoria de cambios al SLA por etapa.
-- Cada UPDATE de etapas_negocio.config_extra.sla_horas (via server action
-- updateEtapaSla) inserta una fila aqui con old/new + user.
--
-- workspace_id denormalizado para RLS sin join.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.etapa_sla_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etapa_id UUID NOT NULL REFERENCES public.etapas_negocio(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  changed_by UUID REFERENCES public.profiles(id),
  old_sla_horas INTEGER,
  new_sla_horas INTEGER,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_etapa_sla_log_workspace_changed
  ON public.etapa_sla_log(workspace_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_etapa_sla_log_etapa
  ON public.etapa_sla_log(etapa_id);

COMMENT ON TABLE public.etapa_sla_log IS
  'Auditoria de cambios al SLA por etapa. Solo owner/admin/supervisor del workspace pueden SELECT.';

-- RLS: solo owner/admin/supervisor del workspace pueden SELECT
ALTER TABLE public.etapa_sla_log ENABLE ROW LEVEL SECURITY;

-- INSERT: server action usa supabase client (RLS aplica)
DROP POLICY IF EXISTS "etapa_sla_log_insert_owner_admin" ON public.etapa_sla_log;
CREATE POLICY "etapa_sla_log_insert_owner_admin"
  ON public.etapa_sla_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id = public.current_user_workspace_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.workspace_id = workspace_id
        AND p.role IN ('owner', 'admin', 'supervisor')
    )
  );

-- SELECT: owner/admin/supervisor del workspace
DROP POLICY IF EXISTS "etapa_sla_log_select_owner_admin_supervisor" ON public.etapa_sla_log;
CREATE POLICY "etapa_sla_log_select_owner_admin_supervisor"
  ON public.etapa_sla_log
  FOR SELECT
  TO authenticated
  USING (
    workspace_id = public.current_user_workspace_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.workspace_id = workspace_id
        AND p.role IN ('owner', 'admin', 'supervisor')
    )
  );
