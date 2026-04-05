CREATE TABLE IF NOT EXISTS ve_procesamiento_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  oportunidad_id UUID NOT NULL,
  procesado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  documentos_procesados TEXT[] NOT NULL DEFAULT '{}',
  campos_extraidos JSONB DEFAULT NULL,
  exitoso BOOLEAN NOT NULL DEFAULT true,
  costo_usd NUMERIC(10,6) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_ve_log_workspace_mes ON ve_procesamiento_log(workspace_id, procesado_en);
