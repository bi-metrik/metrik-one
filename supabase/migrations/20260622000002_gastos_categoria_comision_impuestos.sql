-- ============================================================
-- 20260622000002 — Discriminado de costos ePayco en causacion (F5 SOENA)
-- Reunion Diana: ePayco cobra comision + IVA + retefuente + reteica y NO lo
-- discrimina en su panel. En MeTRIK ONE el desglose SI llega (EpaycoDesglose).
-- Hay que llevarlo a causacion distinguiendo:
--   - comision            -> costo operativo real (clasificacion variable)
--   - impuestos_recuperables (IVA+retefuente+reteica) -> "otra bolsa": impuestos
--     a favor / recuperables, NO costo operativo (clasificacion no_operativo).
--     v_pyl_mes y v_mc_negocio excluyen no_operativo de MC y EBITDA -> no
--     contaminan el margen.
-- ============================================================

-- 1. Ampliar el CHECK de gastos.categoria con las dos categorias nuevas.
--    El CHECK original (crm_v2_rebuild) no incluia 'comision' — por eso el
--    registro F3 cayo en 'servicios_profesionales' (que ademas es 'fijo').
ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_categoria_check;
ALTER TABLE gastos ADD CONSTRAINT gastos_categoria_check CHECK (categoria IN (
  'materiales','transporte','alimentacion','servicios_profesionales',
  'software','arriendo','marketing','capacitacion','otros',
  'comision','impuestos_recuperables'
));

-- 2. Mapeo categoria -> clasificacion default (lo consume el trigger
--    gasto_clasificacion_default en cada INSERT cuando no se pasa explicito).
--    'comision' ya existia como 'variable'. Agregamos impuestos_recuperables.
INSERT INTO categoria_clasificacion_default (categoria, clasificacion_default) VALUES
  ('comision', 'variable'),
  ('impuestos_recuperables', 'no_operativo')
ON CONFLICT (categoria) DO UPDATE
  SET clasificacion_default = EXCLUDED.clasificacion_default;

COMMENT ON CONSTRAINT gastos_categoria_check ON gastos IS
  'Categorias de gasto v2: 9 base + comision (variable, ePayco) + impuestos_recuperables (no_operativo, IVA/retefuente/reteica recuperables — fuera de MC/EBITDA).';
