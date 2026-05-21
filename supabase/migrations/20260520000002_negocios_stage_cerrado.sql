-- ============================================================
-- FASE 1 — Roles · Areas · Stages: ampliar negocios.stage_actual
-- ============================================================
-- negocios.stage_actual ya existe con CHECK ('venta','ejecucion','cobro').
-- Agregamos 'cerrado' como cuarto valor.
--
-- En el modelo nuevo:
--   venta     -> negocio aun no se ejecuta
--   ejecucion -> trabajo en marcha
--   cobro     -> ejecucion terminada, falta recaudo
--   cerrado   -> ciclo terminado (con cierre_motivo)
-- ============================================================

ALTER TABLE negocios DROP CONSTRAINT IF EXISTS negocios_stage_actual_check;
ALTER TABLE negocios ADD CONSTRAINT negocios_stage_actual_check
  CHECK (stage_actual IN ('venta', 'ejecucion', 'cobro', 'cerrado'));

-- ============================================================
-- Backfill: negocios con estado terminal -> stage_actual='cerrado'
-- Estados terminales actuales (ver 20260407000007_negocio_estados_cierre.sql):
--   completado, perdido, cancelado, cerrado (legacy)
-- ============================================================
UPDATE negocios
SET stage_actual = 'cerrado'
WHERE estado IN ('completado', 'perdido', 'cancelado', 'cerrado')
  AND stage_actual <> 'cerrado';

COMMENT ON COLUMN negocios.stage_actual IS
  'Posicion del negocio en el flujo: venta | ejecucion | cobro | cerrado. '
  'Modelo roles-areas-stages Fase 1 (2026-05-20).';
