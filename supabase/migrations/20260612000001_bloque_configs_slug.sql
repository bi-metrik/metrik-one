-- ════════════════════════════════════════════════════════════════════════════
-- Refactor: referencias de workflow atadas a la IDENTIDAD ESTABLE del bloque (slug)
-- Spec: docs/specs/2026-05-26_block-references-by-slug.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA
-- Las referencias cross-bloque del motor de workflow se encodaban de 3 formas
-- frágiles, ninguna atada a la identidad del bloque:
--   1. por (etapa_orden, bloque_orden)  → se rompe al reordenar
--   2. por (source_etapa_orden, nombre) → se rompe al renombrar el bloque
--   3. por source_etapa_orden           → se rompe al reordenar
-- Renombrar "Factura de venta" → "Factura Venta Vehículo" dejó refs apuntando al
-- nombre viejo → datos vacíos en silencio → falsas discrepancias (bug DC13).
--
-- SOLUCIÓN
-- Cada bloque ORIGEN (no heredado) recibe un `slug` estable, único por línea, que
-- NO cambia aunque se renombre o reordene el bloque. Las referencias migran a citar
-- ese slug. Los consumidores en código priorizan el slug y caen al método legacy
-- (nombre/orden) solo si la ref aún no trae slug — retrocompatible.
--
-- Esta migración añade la COLUMNA (genérica de producto). El backfill de slugs por
-- línea y la migración de referencias a slug es por workspace (cada línea define su
-- propia desambiguación de bloques homónimos). Ver migración de cada workspace.
-- ════════════════════════════════════════════════════════════════════════════

-- Identidad estable del bloque dentro de su línea. NULL para heredados readonly
-- (config_extra.source_etapa_orden), que no son origen — apuntan a su bloque fuente.
alter table bloque_configs add column if not exists slug text;

comment on column bloque_configs.slug is
  'Identidad estable del bloque dentro de su línea, inmune a rename/reorder. '
  'Las referencias de workflow (cross_check, auto_fill, campos_fuente, doc_link) lo '
  'citan vía source_bloque_slug / bloque_slug. NULL en heredados readonly. '
  'Único por línea — validar con audit_block_slug_refs(linea_id). '
  'Spec: docs/specs/2026-05-26_block-references-by-slug.md';

-- Índice para resolución rápida por slug en las queries del motor.
create index if not exists idx_bloque_configs_slug on bloque_configs(slug) where slug is not null;
