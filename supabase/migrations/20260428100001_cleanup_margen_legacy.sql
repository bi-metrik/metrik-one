-- ============================================================
-- 20260428100001 — Cleanup margen_* legacy en config_financiera
-- Refactor MC + EBITDA (decision producto 2026-04-23) ya no usa el blend
-- D130. La metrica MC viene de v_pyl_mes (ingresos - costos variables del
-- mes), no de columnas estimadas/calculadas en config_financiera.
-- Spec: docs/specs/2026-04-26_mc-ebitda-capa-fiscal-simplificada.md §1
-- ============================================================

ALTER TABLE config_financiera
  DROP COLUMN IF EXISTS margen_contribucion_estimado,
  DROP COLUMN IF EXISTS margen_contribucion_calculado,
  DROP COLUMN IF EXISTS margen_fuente,
  DROP COLUMN IF EXISTS n_proyectos_margen;

COMMENT ON TABLE config_financiera IS
  'Configuracion financiera del workspace. Margen de contribucion ya no se almacena aqui (post-refactor 2026-04-27); se calcula desde v_pyl_mes.';
