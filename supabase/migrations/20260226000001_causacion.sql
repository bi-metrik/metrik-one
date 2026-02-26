-- D246: Causación contable — flujo PENDIENTE → APROBADO → CAUSADO
-- Cada gasto/cobro debe pasar por validación del dueño + causación del contador
-- Solo CAUSADO dispara integración con Alegra (stub por ahora)

-- ═══════════════════════════════════════════════════════════
-- §1. ALTER TABLE gastos — estado causación + campos contables
-- ═══════════════════════════════════════════════════════════

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS estado_causacion TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado_causacion IN ('PENDIENTE','APROBADO','CAUSADO','RECHAZADO'));

ALTER TABLE gastos ADD COLUMN IF NOT EXISTS aprobado_por UUID REFERENCES auth.users(id);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS fecha_aprobacion TIMESTAMPTZ;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS causado_por UUID REFERENCES auth.users(id);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS fecha_causacion TIMESTAMPTZ;

-- Campos contables (los llena el contador al causar)
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS cuenta_contable TEXT;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS centro_costo TEXT;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS notas_causacion TEXT;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS retencion_aplicada NUMERIC(15,2);

-- Rechazo
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS rechazo_motivo TEXT;

-- Trazabilidad Alegra (stub)
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS enviado_alegra BOOLEAN DEFAULT false;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS alegra_id TEXT;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS fecha_envio_alegra TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════
-- §2. ALTER TABLE cobros — misma estructura
-- ═══════════════════════════════════════════════════════════

ALTER TABLE cobros
  ADD COLUMN IF NOT EXISTS estado_causacion TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado_causacion IN ('PENDIENTE','APROBADO','CAUSADO','RECHAZADO'));

ALTER TABLE cobros ADD COLUMN IF NOT EXISTS aprobado_por UUID REFERENCES auth.users(id);
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS fecha_aprobacion TIMESTAMPTZ;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS causado_por UUID REFERENCES auth.users(id);
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS fecha_causacion TIMESTAMPTZ;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS cuenta_contable TEXT;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS centro_costo TEXT;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS notas_causacion TEXT;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS retencion_aplicada NUMERIC(15,2);
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS rechazo_motivo TEXT;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS enviado_alegra BOOLEAN DEFAULT false;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS alegra_id TEXT;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS fecha_envio_alegra TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════
-- §3. Grandfather existing records as CAUSADO
-- ═══════════════════════════════════════════════════════════

UPDATE gastos SET estado_causacion = 'CAUSADO', fecha_causacion = created_at
  WHERE estado_causacion = 'PENDIENTE';

UPDATE cobros SET estado_causacion = 'CAUSADO', fecha_causacion = created_at
  WHERE estado_causacion = 'PENDIENTE';

-- ═══════════════════════════════════════════════════════════
-- §4. Indexes
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_gastos_estado_causacion
  ON gastos(workspace_id, estado_causacion);

CREATE INDEX IF NOT EXISTS idx_cobros_estado_causacion
  ON cobros(workspace_id, estado_causacion);

CREATE INDEX IF NOT EXISTS idx_gastos_causacion_bandeja
  ON gastos(workspace_id, estado_causacion, fecha DESC)
  WHERE estado_causacion = 'APROBADO';

CREATE INDEX IF NOT EXISTS idx_cobros_causacion_bandeja
  ON cobros(workspace_id, estado_causacion, fecha DESC)
  WHERE estado_causacion = 'APROBADO';

-- ═══════════════════════════════════════════════════════════
-- §5. Tabla causaciones_log — auditoría de cambios de estado
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS causaciones_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  tabla TEXT NOT NULL CHECK (tabla IN ('gastos','cobros')),
  registro_id UUID NOT NULL,
  accion TEXT NOT NULL CHECK (accion IN ('APROBAR','CAUSAR','RECHAZAR')),
  estado_anterior TEXT NOT NULL,
  estado_nuevo TEXT NOT NULL,
  datos JSONB,
  motivo TEXT,
  realizado_por UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE causaciones_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "causaciones_log_ws" ON causaciones_log
  FOR ALL USING (workspace_id = current_user_workspace_id());

CREATE INDEX IF NOT EXISTS idx_causaciones_log_ws
  ON causaciones_log(workspace_id, created_at DESC);

COMMENT ON TABLE causaciones_log IS 'D246: Auditoría de cambios de estado de causación contable';
COMMENT ON COLUMN gastos.estado_causacion IS 'D246: PENDIENTE → APROBADO → CAUSADO (+ RECHAZADO)';
COMMENT ON COLUMN cobros.estado_causacion IS 'D246: PENDIENTE → APROBADO → CAUSADO (+ RECHAZADO)';
