-- ============================================================
-- FASE 1 — Roles · Areas · Stages: tabla staff_areas (N:M)
-- ============================================================
-- Cada staff puede pertenecer a 1 o mas areas funcionales.
-- Areas: comercial, operaciones, financiera
-- Reglas por rol (validadas via trigger en migracion separada cuando
-- exista la canExitBloque). En Fase 1 solo data + constraints minimas.
--
-- Reglas operativas (documentadas, no enforced aun en Fase 1):
--   - supervisor: exactamente 1 area
--   - operator:   1 o 2 areas
--   - admin/owner: sin limite (puede tener 0)
--   - contador / read_only: 0 areas (no entran al modelo)
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_areas (
  staff_id  UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  area      TEXT NOT NULL CHECK (area IN ('comercial', 'operaciones', 'financiera')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (staff_id, area)
);

CREATE INDEX IF NOT EXISTS idx_staff_areas_area ON staff_areas(area);
CREATE INDEX IF NOT EXISTS idx_staff_areas_staff ON staff_areas(staff_id);

COMMENT ON TABLE staff_areas IS
  'N:M staff <-> areas funcionales (comercial / operaciones / financiera). '
  'Modelo roles-areas-stages Fase 1 (2026-05-20).';

-- ============================================================
-- Backfill desde staff.area (scalar) cuando no sea null
-- ============================================================
INSERT INTO staff_areas (staff_id, area)
SELECT id, LOWER(TRIM(area))
FROM staff
WHERE area IS NOT NULL
  AND LOWER(TRIM(area)) IN ('comercial', 'operaciones', 'financiera')
ON CONFLICT DO NOTHING;

-- Nota: NO se elimina staff.area aun. Deprecation suave hasta fin Fase 6.
COMMENT ON COLUMN staff.area IS
  'DEPRECATED — usar staff_areas (N:M). Mantenido hasta cierre Fase 6 del modelo roles-areas-stages.';
