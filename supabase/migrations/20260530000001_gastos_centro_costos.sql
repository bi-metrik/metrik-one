-- ============================================================
-- Centro de costos: atribución de gastos por centro
-- ============================================================
--
-- Agrega 3 columnas NULLABLE a gastos:
--   centro_costos        — uno de 4 valores (directa_negocio, distribuible_one,
--                          distribuible_clarity, mixta)
--   split_json           — solo para mixta: {"distribuible_one":0.6,"negocio:UUID":0.4}
--   origen_asignacion    — auditoría de cómo se asignó (auto/sugerido/manual/split)
--
-- Todas NULLABLE inicialmente para no romper inserts existentes ni el bot WA.
-- Backfill de huérfanos lo maneja Mauricio aparte.
-- ============================================================

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS centro_costos text
    CHECK (centro_costos IN (
      'directa_negocio',
      'distribuible_one',
      'distribuible_clarity',
      'mixta'
    )),
  ADD COLUMN IF NOT EXISTS split_json jsonb,
  ADD COLUMN IF NOT EXISTS origen_asignacion text
    CHECK (origen_asignacion IN ('auto', 'sugerido', 'manual', 'split'));

-- Índice para consultas por centro de costos (reportes, filtros UI)
CREATE INDEX IF NOT EXISTS idx_gastos_centro_costos
  ON gastos (workspace_id, centro_costos)
  WHERE centro_costos IS NOT NULL;

-- Comentarios para documentación in-DB
COMMENT ON COLUMN gastos.centro_costos IS
  'Centro de costos al que se atribuye el gasto. NULL = legacy/sin clasificar (backfill aparte).';

COMMENT ON COLUMN gastos.split_json IS
  'Solo aplica cuando centro_costos = mixta. Estructura: {"distribuible_one":0.6,"negocio:<uuid>":0.4}. Las claves pueden ser uno de los centros distribuibles o "negocio:<uuid>" para imputaciones a negocios específicos. Los valores son fracciones (0-1) que deben sumar 1.0.';

COMMENT ON COLUMN gastos.origen_asignacion IS
  'Auditoría de cómo se asignó: auto (whitelist proveedor silenciosa), sugerido (heurística aceptada), manual (usuario eligió), split (mixta con desglose).';
