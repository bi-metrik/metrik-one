-- ============================================================
-- 20260427100001 — Taxonomia clasificacion_costo
-- Decision producto 2026-04-23: MC + EBITDA como metricas norte.
-- Cada gasto se clasifica como variable / fijo / no_operativo.
-- Spec: docs/specs/2026-04-26_mc-ebitda-capa-fiscal-simplificada.md §2
-- ============================================================

-- Tabla mapeo categoria → clasificacion default (editable post-migration)
CREATE TABLE IF NOT EXISTS categoria_clasificacion_default (
  categoria TEXT PRIMARY KEY,
  clasificacion_default TEXT NOT NULL CHECK (clasificacion_default IN ('variable','fijo','no_operativo')),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed: taxonomia firmada Carmen+Santiago 2026-04-26
INSERT INTO categoria_clasificacion_default (categoria, clasificacion_default) VALUES
  ('comision', 'variable'),
  ('materiales', 'variable'),
  ('transporte', 'variable'),
  ('viaticos', 'variable'),
  ('mano_de_obra', 'variable'),
  ('alimentacion', 'variable'),
  ('servicios_profesionales', 'fijo'),
  ('software', 'fijo'),
  ('impuestos_seguros', 'fijo'),
  ('arriendo', 'fijo'),
  ('marketing', 'fijo'),
  ('capacitacion', 'fijo'),
  ('otros', 'variable'),
  ('impuesto_renta', 'no_operativo'),
  ('intereses_financieros', 'no_operativo')
ON CONFLICT (categoria) DO NOTHING;

-- Columna en gastos: nullable inicial para que trigger pueda detectar "no provisto"
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS clasificacion_costo TEXT
    CHECK (clasificacion_costo IS NULL OR clasificacion_costo IN ('variable','fijo','no_operativo'));

-- Trigger BEFORE INSERT: si NEW.clasificacion_costo IS NULL → lookup mapeo → fallback 'variable'
-- Si el app envia valor explicito, se respeta (override por workspace).
CREATE OR REPLACE FUNCTION gasto_clasificacion_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  default_clasif TEXT;
BEGIN
  IF NEW.clasificacion_costo IS NULL THEN
    SELECT clasificacion_default INTO default_clasif
      FROM categoria_clasificacion_default
      WHERE categoria = NEW.categoria;
    NEW.clasificacion_costo := COALESCE(default_clasif, 'variable');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gasto_clasificacion_default ON gastos;
CREATE TRIGGER trg_gasto_clasificacion_default
  BEFORE INSERT ON gastos
  FOR EACH ROW
  EXECUTE FUNCTION gasto_clasificacion_default();

-- Backfill: gastos historicos
-- Si tiene negocio_id → variable (es imputable a un negocio)
-- Si no → lookup mapeo → fallback variable
UPDATE gastos
   SET clasificacion_costo = CASE
     WHEN negocio_id IS NOT NULL THEN 'variable'
     ELSE COALESCE(
       (SELECT clasificacion_default FROM categoria_clasificacion_default WHERE categoria = gastos.categoria),
       'variable'
     )
   END
 WHERE clasificacion_costo IS NULL;

-- Una vez backfill aplicado, hacer la columna NOT NULL (defensa de integridad)
ALTER TABLE gastos
  ALTER COLUMN clasificacion_costo SET NOT NULL,
  ALTER COLUMN clasificacion_costo SET DEFAULT 'variable';

CREATE INDEX IF NOT EXISTS idx_gastos_clasificacion_costo
  ON gastos(workspace_id, clasificacion_costo);

-- Tabla mapeo: lectura publica para todos los workspaces (es config global)
ALTER TABLE categoria_clasificacion_default ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'categoria_clasificacion_default' AND policyname = 'categoria_clasificacion_default_read') THEN
    CREATE POLICY "categoria_clasificacion_default_read" ON categoria_clasificacion_default
      FOR SELECT USING (true);
  END IF;
END $$;

COMMENT ON TABLE categoria_clasificacion_default IS
  'Mapeo global categoria → clasificacion default. Editable por owner de la plataforma. Trigger gasto_clasificacion_default lo consulta en cada INSERT.';
COMMENT ON COLUMN gastos.clasificacion_costo IS
  'Taxonomia costos v1: variable (desaparece sin ventas), fijo (recurrente), no_operativo (impuesto renta, intereses). Default variable por defensa MC.';
