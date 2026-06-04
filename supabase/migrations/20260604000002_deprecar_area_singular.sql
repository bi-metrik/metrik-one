-- ============================================================
-- Consolidar area en staff_areas — deprecar columnas singulares
-- ============================================================
-- Contexto: el "area" de un miembro vivia disperso en 3 lugares:
--   - staff_areas (N:M)        -> FUENTE CANONICA (la lee getWorkspace/guards)
--   - staff.area (singular)    -> escrita por Config -> Equipo, vocab 'admin_finanzas'
--   - profiles.area (singular) -> nunca escrita (columna muerta)
--
-- Decision 2026-06-04 (Mauricio): staff_areas es fuente unica.
--   - El selector de area de Config -> Equipo se elimina (la asignacion vive
--     solo en mi-negocio/equipo).
--   - El cron procesar-planes-cobro se reapunta a staff_areas (financiera).
--   - Los crons de inactividad dejan de leer profiles.area (siempre null).
--
-- Esta migracion:
--   1. Re-backfill DEFENSIVO de staff.area -> staff_areas (mapeo
--      admin_finanzas -> financiera) para cubrir cualquier drift entre el
--      snapshot de 20260520000010 y este deploy. Idempotente.
--   2. Marca staff.area y profiles.area como DEPRECATED (sin DROP — la
--      eliminacion fisica queda para una migracion posterior cuando se
--      confirme cero consumidores en produccion).
--
-- NO se hace DROP de columnas. NO se asigna area a staff con area NULL.
-- Fuente: sesion /one 2026-06-04 (consolidacion modelo de equipo).
-- ============================================================

-- ── 1. Re-backfill defensivo staff.area -> staff_areas ───────
-- Mapea admin_finanzas -> financiera; el resto pasa tal cual.
-- El CHECK de staff_areas (20260520000010) ya admite las 4 areas validas.
INSERT INTO staff_areas (staff_id, area)
SELECT
  s.id,
  CASE WHEN LOWER(TRIM(s.area)) = 'admin_finanzas' THEN 'financiera'
       ELSE LOWER(TRIM(s.area)) END AS area
FROM staff s
WHERE s.area IS NOT NULL
  AND TRIM(s.area) <> ''
  AND (
    CASE WHEN LOWER(TRIM(s.area)) = 'admin_finanzas' THEN 'financiera'
         ELSE LOWER(TRIM(s.area)) END
  ) IN ('comercial', 'operaciones', 'financiera', 'direccion')
ON CONFLICT DO NOTHING;

-- ── 2. Deprecacion suave (comentarios, sin DROP) ─────────────
COMMENT ON COLUMN staff.area IS
  'DEPRECATED (2026-06-04). Fuente unica de area = staff_areas (N:M). '
  'Esta columna ya no se escribe (selector removido de Config -> Equipo) '
  'ni se lee. DROP pendiente tras confirmar cero consumidores en prod.';

COMMENT ON COLUMN profiles.area IS
  'DEPRECATED (2026-06-04). Columna muerta: nunca fue escrita. El area de '
  'un miembro vive en staff_areas. DROP pendiente tras confirmar cero '
  'consumidores en prod.';
