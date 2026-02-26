-- Add created_by to gastos and cobros so we can track who registered each movement
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_gastos_created_by ON gastos(created_by);

ALTER TABLE cobros ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_cobros_created_by ON cobros(created_by);
