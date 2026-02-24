-- D129/D130/D131: Nómina compuesta + Margen de contribución progresivo
-- Addendum a [98A] v2.1 y [99] v2.0

-- 1. Tabla config_financiera (una por workspace)
CREATE TABLE config_financiera (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  margen_contribucion_estimado NUMERIC(5,4) DEFAULT 0.95,
  margen_contribucion_calculado NUMERIC(5,4),
  margen_fuente VARCHAR(20) DEFAULT 'estimado',
  n_proyectos_margen INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id)
);

ALTER TABLE config_financiera ENABLE ROW LEVEL SECURITY;

CREATE POLICY "config_financiera_select" ON config_financiera
  FOR SELECT USING (workspace_id = current_user_workspace_id());

CREATE POLICY "config_financiera_insert" ON config_financiera
  FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());

CREATE POLICY "config_financiera_update" ON config_financiera
  FOR UPDATE USING (workspace_id = current_user_workspace_id());

-- 2. Trigger: recalcular margen al cerrar proyecto
CREATE OR REPLACE FUNCTION recalcular_margen()
RETURNS TRIGGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.estado = 'cerrado' AND (OLD.estado IS DISTINCT FROM 'cerrado') THEN
    -- Count projects with valid financial data
    SELECT COUNT(*) INTO v_count
    FROM proyectos
    WHERE workspace_id = NEW.workspace_id
      AND estado = 'cerrado'
      AND fecha_cierre > CURRENT_DATE - interval '6 months'
      AND cierre_snapshot IS NOT NULL
      AND (cierre_snapshot->>'presupuesto_total')::numeric > 0;

    -- Upsert config_financiera
    INSERT INTO config_financiera (workspace_id)
    VALUES (NEW.workspace_id)
    ON CONFLICT (workspace_id) DO NOTHING;

    -- Update margin calculation
    UPDATE config_financiera SET
      margen_contribucion_calculado = (
        SELECT
          SUM(
            (1 - LEAST(
              COALESCE((p2.cierre_snapshot->>'costo_acumulado')::numeric, 0)
              / NULLIF((p2.cierre_snapshot->>'presupuesto_total')::numeric, 0),
              1
            ))
            * (p2.cierre_snapshot->>'presupuesto_total')::numeric
          )
          / NULLIF(SUM((p2.cierre_snapshot->>'presupuesto_total')::numeric), 0)
        FROM proyectos p2
        WHERE p2.workspace_id = NEW.workspace_id
          AND p2.estado = 'cerrado'
          AND p2.fecha_cierre > CURRENT_DATE - interval '6 months'
          AND p2.cierre_snapshot IS NOT NULL
          AND (p2.cierre_snapshot->>'presupuesto_total')::numeric > 0
      ),
      n_proyectos_margen = v_count,
      margen_fuente = CASE WHEN v_count >= 3 THEN 'calculado' ELSE 'mixto' END,
      updated_at = NOW()
    WHERE workspace_id = NEW.workspace_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_margen
  AFTER UPDATE ON proyectos
  FOR EACH ROW
  EXECUTE FUNCTION recalcular_margen();
