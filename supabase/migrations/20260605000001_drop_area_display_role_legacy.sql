-- ============================================================
-- Limpieza de columnas legacy: staff.area, profiles.area,
-- staff.display_role, profiles.display_role
-- ============================================================
-- Contexto:
--   - 'area' se consolido en staff_areas (N:M) el 2026-06-04. Columnas
--     singulares deprecadas; cero consumidores en codigo.
--   - 'display_role' se reemplazo por staff.position en el header del
--     workspace (2026-06-04). Cero consumidores: invite/accept-invite y
--     StaffConAreas dejaron de leer/escribir display_role.
--
-- IMPORTANTE: aplicar SOLO despues de deployar el codigo que ya no usa
-- estas columnas (orden backward-compatible).
--
-- Dependencia: idx_profiles_role_area (workspace_id, role, area) -> se
-- recrea sin 'area' como (workspace_id, role); los crons de inactividad
-- ya no filtran por area.
-- ============================================================

-- Recrear indice sin la columna 'area'
DROP INDEX IF EXISTS idx_profiles_role_area;
CREATE INDEX IF NOT EXISTS idx_profiles_workspace_role
  ON public.profiles (workspace_id, role);

-- DROP de columnas legacy
ALTER TABLE public.staff    DROP COLUMN IF EXISTS area;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS area;
ALTER TABLE public.staff    DROP COLUMN IF EXISTS display_role;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS display_role;
