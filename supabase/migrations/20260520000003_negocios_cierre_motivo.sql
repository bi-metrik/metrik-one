-- ============================================================
-- FASE 1 — Roles · Areas · Stages: negocios.cierre_motivo
-- ============================================================
-- Cuando stage_actual = 'cerrado', el negocio tiene un motivo de cierre:
--   exitoso  -> proyecto completado y cobrado
--   perdido  -> venta no concretada
--   cancelado -> ejecucion terminada antes de tiempo
--
-- NULL cuando stage_actual <> 'cerrado'.
--
-- Orden estricto: agregar columna + check de dominio -> backfill -> agregar
-- constraint de coherencia con stage_actual (la coherencia falla mientras
-- no este backfilleada la columna).
-- ============================================================

-- 1. Columna + CHECK de dominio (sin coherencia aun)
ALTER TABLE negocios
  ADD COLUMN IF NOT EXISTS cierre_motivo TEXT
    CHECK (cierre_motivo IN ('exitoso', 'perdido', 'cancelado'));

-- 2. Backfill (antes de la constraint de coherencia)
--    completado / cerrado (legacy) -> exitoso
UPDATE negocios
SET cierre_motivo = 'exitoso'
WHERE stage_actual = 'cerrado'
  AND cierre_motivo IS NULL
  AND estado IN ('completado', 'cerrado');

--    perdido -> perdido
UPDATE negocios
SET cierre_motivo = 'perdido'
WHERE stage_actual = 'cerrado'
  AND cierre_motivo IS NULL
  AND estado = 'perdido';

--    cancelado -> cancelado
UPDATE negocios
SET cierre_motivo = 'cancelado'
WHERE stage_actual = 'cerrado'
  AND cierre_motivo IS NULL
  AND estado = 'cancelado';

--    Default defensivo: cualquier cerrado sin clasificar (legacy 'activo'
--    o estados raros) -> exitoso
UPDATE negocios
SET cierre_motivo = 'exitoso'
WHERE stage_actual = 'cerrado'
  AND cierre_motivo IS NULL;

-- 3. Constraint de coherencia (ahora si pasa)
ALTER TABLE negocios DROP CONSTRAINT IF EXISTS negocios_cierre_motivo_coherente;
ALTER TABLE negocios ADD CONSTRAINT negocios_cierre_motivo_coherente
  CHECK (
    (stage_actual = 'cerrado' AND cierre_motivo IS NOT NULL)
    OR
    (stage_actual <> 'cerrado' AND cierre_motivo IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_negocios_cierre_motivo
  ON negocios(workspace_id, cierre_motivo)
  WHERE cierre_motivo IS NOT NULL;

COMMENT ON COLUMN negocios.cierre_motivo IS
  'Motivo de cierre del negocio cuando stage_actual=cerrado. '
  'exitoso | perdido | cancelado. NULL si negocio activo. '
  'Modelo roles-areas-stages Fase 1 (2026-05-20).';
