-- ============================================================
-- El centro de costos deja de preguntarse donde nadie lo contesta.
--
-- El selector aparecía en el registro de gasto de todos los workspaces. Medido el
-- 2026-09-12 sobre los 320 gastos de producción:
--
--   metrik   33 de 39 con centro asignado
--   wmc-sm   11 de 28
--   soena     0 de 171
--   dimpro    0 de 55
--   ana-demo  0 de 27
--
-- Tres workspaces llevan 253 gastos y ni uno solo con centro. A ellos el campo les
-- cobraba una pregunta que nunca respondieron, en el peor momento: el de la captura.
-- Pasa a opt-in y se enciende exactamente donde ya hay datos.
-- ============================================================

update workspaces
set modules = coalesce(modules, '{}'::jsonb) || '{"centro_costos": true}'::jsonb
where slug in ('metrik', 'wmc-sm');
