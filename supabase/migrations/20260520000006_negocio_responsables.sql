-- ============================================================
-- FASE 1 — Roles · Areas · Stages: tabla negocio_responsables (N:M)
-- ============================================================
-- Un negocio puede tener N responsables. Reemplaza eventualmente a
-- negocios.responsable_id (scalar), que queda en deprecation suave hasta
-- Fase 6.
-- ============================================================

CREATE TABLE IF NOT EXISTS negocio_responsables (
  negocio_id   UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (negocio_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_negocio_responsables_staff
  ON negocio_responsables(staff_id);

CREATE INDEX IF NOT EXISTS idx_negocio_responsables_negocio
  ON negocio_responsables(negocio_id);

-- RLS
ALTER TABLE negocio_responsables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "negocio_responsables_read" ON negocio_responsables
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM negocios n
      WHERE n.id = negocio_responsables.negocio_id
        AND n.workspace_id = current_user_workspace_id()
    )
  );

CREATE POLICY "negocio_responsables_write" ON negocio_responsables
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM negocios n
      WHERE n.id = negocio_responsables.negocio_id
        AND n.workspace_id = current_user_workspace_id()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM negocios n
      WHERE n.id = negocio_responsables.negocio_id
        AND n.workspace_id = current_user_workspace_id()
    )
  );

COMMENT ON TABLE negocio_responsables IS
  'N:M negocios <-> staff. Reemplaza negocios.responsable_id (scalar). '
  'Modelo roles-areas-stages Fase 1 (2026-05-20).';

-- ============================================================
-- Backfill desde negocios.responsable_id (scalar actual)
-- ============================================================
INSERT INTO negocio_responsables (negocio_id, staff_id, assigned_at)
SELECT id, responsable_id, COALESCE(created_at, NOW())
FROM negocios
WHERE responsable_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill adicional: si una linea tenia responsable historico via
-- oportunidades.responsable_id (legacy ya extirpado pero tablas sobreviven
-- en DB), no aplicamos — pipeline/proyectos quedo deprecated y sus
-- responsables historicos no son relevantes para el modelo nuevo.

COMMENT ON COLUMN negocios.responsable_id IS
  'DEPRECATED — usar negocio_responsables (N:M). Mantenido hasta cierre Fase 6.';
