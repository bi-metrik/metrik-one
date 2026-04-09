-- Migration: tabla riesgos + riesgos_controles
-- Modulo compliance: catalogo de riesgos SARLAFT por workspace

-- Tabla riesgos (catalogo de riesgos del workspace)
CREATE TABLE riesgos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  codigo TEXT, -- auto-generado: R-001, R-002...
  categoria TEXT NOT NULL CHECK (categoria IN ('LA', 'FT', 'FPADM', 'PTEE')),
  descripcion TEXT NOT NULL,
  factor_riesgo TEXT NOT NULL CHECK (factor_riesgo IN ('clientes', 'proveedores', 'empleados', 'canales', 'jurisdicciones', 'productos', 'operaciones')),
  probabilidad INTEGER NOT NULL CHECK (probabilidad BETWEEN 1 AND 5),
  impacto INTEGER NOT NULL CHECK (impacto BETWEEN 1 AND 5),
  nivel_riesgo TEXT GENERATED ALWAYS AS (
    CASE
      WHEN probabilidad * impacto >= 20 THEN 'CRITICO'
      WHEN probabilidad * impacto >= 12 THEN 'ALTO'
      WHEN probabilidad * impacto >= 6 THEN 'MEDIO'
      ELSE 'BAJO'
    END
  ) STORED,
  estado TEXT NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO', 'BAJO_CONTROL', 'MONITOREADO', 'MITIGADO', 'REPORTADO', 'CERRADO')),
  responsable_id UUID REFERENCES profiles(id),
  fuente_identificacion TEXT CHECK (fuente_identificacion IN ('cliente_nuevo', 'transaccion_atipica', 'lista_internacional', 'reporte_interno', 'auditoria', 'otro')),
  fecha_identificacion DATE DEFAULT CURRENT_DATE,
  fecha_evaluacion DATE,
  evaluado_por UUID REFERENCES profiles(id),
  evidencias JSONB DEFAULT '[]'::jsonb,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX idx_riesgos_workspace ON riesgos(workspace_id);
CREATE INDEX idx_riesgos_categoria ON riesgos(workspace_id, categoria);
CREATE INDEX idx_riesgos_nivel ON riesgos(workspace_id, nivel_riesgo);
CREATE UNIQUE INDEX idx_riesgos_codigo ON riesgos(workspace_id, codigo);

-- Auto-codigo R-001, R-002...
CREATE OR REPLACE FUNCTION generate_riesgo_codigo()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(codigo FROM 3) AS INTEGER)), 0) + 1
  INTO next_num
  FROM riesgos
  WHERE workspace_id = NEW.workspace_id;

  NEW.codigo := 'R-' || LPAD(next_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_riesgo_auto_codigo
  BEFORE INSERT ON riesgos
  FOR EACH ROW
  WHEN (NEW.codigo IS NULL)
  EXECUTE FUNCTION generate_riesgo_codigo();

-- RLS
ALTER TABLE riesgos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "riesgos_select" ON riesgos
  FOR SELECT USING (workspace_id = current_user_workspace_id());

CREATE POLICY "riesgos_insert" ON riesgos
  FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());

CREATE POLICY "riesgos_update" ON riesgos
  FOR UPDATE USING (workspace_id = current_user_workspace_id());

CREATE POLICY "riesgos_delete" ON riesgos
  FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Tabla junction riesgos <-> controles (negocios) para fase 2
CREATE TABLE riesgos_controles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  riesgo_id UUID NOT NULL REFERENCES riesgos(id) ON DELETE CASCADE,
  negocio_id UUID REFERENCES negocios(id) ON DELETE SET NULL, -- control = negocio en fase 2
  nombre_control TEXT NOT NULL,
  tipo_control TEXT NOT NULL CHECK (tipo_control IN ('preventivo', 'detectivo', 'correctivo')),
  clasificacion TEXT DEFAULT 'manual' CHECK (clasificacion IN ('automatico', 'manual', 'hibrido')),
  periodicidad TEXT CHECK (periodicidad IN ('continuo', 'diaria', 'semanal', 'mensual', 'trimestral', 'semestral', 'anual', 'evento')),
  responsable_id UUID REFERENCES profiles(id),
  estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'IMPLEMENTADO', 'EN_PROGRESO', 'SUSPENDIDO')),
  config_extra JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rc_workspace ON riesgos_controles(workspace_id);
CREATE INDEX idx_rc_riesgo ON riesgos_controles(riesgo_id);

ALTER TABLE riesgos_controles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rc_select" ON riesgos_controles
  FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "rc_insert" ON riesgos_controles
  FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "rc_update" ON riesgos_controles
  FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "rc_delete" ON riesgos_controles
  FOR DELETE USING (workspace_id = current_user_workspace_id());
