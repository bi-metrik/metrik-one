-- ============================================================
-- FASE 2 — Roles · Areas · Stages: D1 legacy staff_area mapping
-- ============================================================
-- Cambios:
--   1. Ampliar CHECK de staff_areas.area para aceptar 'direccion'
--   2. Ampliar CHECK de workspace_default_responsables.area para 'direccion'
--      (necesario aunque workspace_default_responsables operativo solo
--       use comercial/operaciones/financiera — coherencia del modelo)
--   3. Backfill: admin_finanzas (1 staff) -> financiera
--   4. Backfill: direccion (4 staff segun BD) -> staff_areas con area=direccion
--
-- IMPORTANTE: NO se hace bulk-assign de los 12 staff con area=NULL.
-- Mauricio los revisa WS-por-WS sin asignacion automatica (D1 cerrada).
--
-- Fuente: cerebro/decisiones/2026-05-20_modelo-roles-areas-stages.md
-- ============================================================

-- ── 1. Ampliar CHECK staff_areas para 'direccion' ────────────
ALTER TABLE staff_areas
  DROP CONSTRAINT IF EXISTS staff_areas_area_check;

ALTER TABLE staff_areas
  ADD CONSTRAINT staff_areas_area_check
  CHECK (area IN ('comercial', 'operaciones', 'financiera', 'direccion'));

COMMENT ON COLUMN staff_areas.area IS
  'Area funcional del staff. 3 areas operativas (comercial/operaciones/financiera) '
  'y 1 transversal (direccion). Direccion da acceso a stages de las 3 areas '
  'operativas como si tuviera las 3 simultaneamente. NO es un rol — es etiqueta.';

-- ── 2. Ampliar CHECK workspace_default_responsables (coherencia, aunque uso operativo es 3 areas) ──
ALTER TABLE workspace_default_responsables
  DROP CONSTRAINT IF EXISTS workspace_default_responsables_area_check;

ALTER TABLE workspace_default_responsables
  ADD CONSTRAINT workspace_default_responsables_area_check
  CHECK (area IN ('comercial', 'operaciones', 'financiera'));
  -- Nota: NO se permite 'direccion' aqui — la cascada de asignacion se basa
  -- en el area duena del stage (siempre operativa). Direccion es una etiqueta
  -- del staff, no del workspace default.

-- ── 3. Backfill: admin_finanzas → financiera ─────────────────
INSERT INTO staff_areas (staff_id, area)
SELECT id, 'financiera'
FROM staff
WHERE LOWER(TRIM(area)) = 'admin_finanzas'
ON CONFLICT DO NOTHING;

-- ── 4. Backfill: direccion (4 staff esperados, no 5 como decision) ──
INSERT INTO staff_areas (staff_id, area)
SELECT id, 'direccion'
FROM staff
WHERE LOWER(TRIM(area)) = 'direccion'
ON CONFLICT DO NOTHING;

-- NO se hace bulk-assign de los 12 staff NULL (D1 cerrada).
