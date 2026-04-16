-- Actualizar metodologia de riesgos a SARLAFT completa:
-- 4 dimensiones de impacto ponderado (Legal 0.3, Reputacional 0.4, Operativo 0.2, Contagio 0.1),
-- probabilidad por ocurrencia/frecuencia, nivel por lookup matrix 5x5,
-- tabla de causas, efectividad de controles 7 factores.

-- 1. Nuevas columnas en riesgos
ALTER TABLE riesgos
  ADD COLUMN IF NOT EXISTS referencia TEXT,
  ADD COLUMN IF NOT EXISTS evento_riesgo TEXT,
  ADD COLUMN IF NOT EXISTS impacto_legal INT CHECK (impacto_legal BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS impacto_reputacional INT CHECK (impacto_reputacional BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS impacto_operativo INT CHECK (impacto_operativo BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS impacto_contagio INT CHECK (impacto_contagio BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS probabilidad_tipo TEXT CHECK (probabilidad_tipo IN ('ocurrencia', 'frecuencia')),
  ADD COLUMN IF NOT EXISTS probabilidad_ocurrencia INT CHECK (probabilidad_ocurrencia BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS probabilidad_frecuencia INT CHECK (probabilidad_frecuencia BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS riesgo_residual_probabilidad INT,
  ADD COLUMN IF NOT EXISTS riesgo_residual_impacto INT,
  ADD COLUMN IF NOT EXISTS nivel_riesgo_residual TEXT;

-- 2. Recrear nivel_riesgo con lookup matrix SARLAFT 5x5
--    Prob\Imp  1     2        3        4       5
--      5     Bajo  Moderado  Alto   Extremo  Extremo
--      4     Bajo  Moderado  Alto    Alto    Extremo
--      3     Bajo  Moderado Moderado Alto    Extremo
--      2     Bajo  Moderado Moderado Alto    Extremo
--      1     Bajo   Bajo    Moderado Alto    Extremo
ALTER TABLE riesgos DROP COLUMN IF EXISTS nivel_riesgo;
ALTER TABLE riesgos ADD COLUMN nivel_riesgo TEXT GENERATED ALWAYS AS (
  CASE (probabilidad * 10 + impacto)
    WHEN 11 THEN 'BAJO' WHEN 12 THEN 'BAJO' WHEN 13 THEN 'MODERADO' WHEN 14 THEN 'ALTO' WHEN 15 THEN 'EXTREMO'
    WHEN 21 THEN 'BAJO' WHEN 22 THEN 'MODERADO' WHEN 23 THEN 'MODERADO' WHEN 24 THEN 'ALTO' WHEN 25 THEN 'EXTREMO'
    WHEN 31 THEN 'BAJO' WHEN 32 THEN 'MODERADO' WHEN 33 THEN 'MODERADO' WHEN 34 THEN 'ALTO' WHEN 35 THEN 'EXTREMO'
    WHEN 41 THEN 'BAJO' WHEN 42 THEN 'MODERADO' WHEN 43 THEN 'ALTO' WHEN 44 THEN 'ALTO' WHEN 45 THEN 'EXTREMO'
    WHEN 51 THEN 'BAJO' WHEN 52 THEN 'MODERADO' WHEN 53 THEN 'ALTO' WHEN 54 THEN 'EXTREMO' WHEN 55 THEN 'EXTREMO'
    ELSE 'BAJO'
  END
) STORED;

-- 3. Trigger para calcular impacto/probabilidad consolidados desde dimensiones
CREATE OR REPLACE FUNCTION compute_riesgo_dimensions()
RETURNS TRIGGER AS $$
BEGIN
  -- Calcular impacto ponderado: Legal(0.3) + Reputacional(0.4) + Operativo(0.2) + Contagio(0.1)
  IF NEW.impacto_legal IS NOT NULL THEN
    NEW.impacto := ROUND(
      COALESCE(NEW.impacto_legal, 1) * 0.3 +
      COALESCE(NEW.impacto_reputacional, 1) * 0.4 +
      COALESCE(NEW.impacto_operativo, 1) * 0.2 +
      COALESCE(NEW.impacto_contagio, 1) * 0.1
    )::int;
    IF NEW.impacto < 1 THEN NEW.impacto := 1; END IF;
    IF NEW.impacto > 5 THEN NEW.impacto := 5; END IF;
  END IF;

  -- Calcular probabilidad: mayor entre ocurrencia y frecuencia
  IF NEW.probabilidad_ocurrencia IS NOT NULL OR NEW.probabilidad_frecuencia IS NOT NULL THEN
    NEW.probabilidad := GREATEST(
      COALESCE(NEW.probabilidad_ocurrencia, 0),
      COALESCE(NEW.probabilidad_frecuencia, 0)
    );
    IF NEW.probabilidad < 1 THEN NEW.probabilidad := 1; END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_riesgo_compute_dimensions ON riesgos;
CREATE TRIGGER trg_riesgo_compute_dimensions
  BEFORE INSERT OR UPDATE ON riesgos
  FOR EACH ROW EXECUTE FUNCTION compute_riesgo_dimensions();

-- 4. Tabla riesgo_causas (analisis causa-efecto por riesgo)
CREATE TABLE IF NOT EXISTS riesgo_causas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  riesgo_id UUID NOT NULL REFERENCES riesgos(id) ON DELETE CASCADE,
  referencia TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  factor_riesgo TEXT,
  contexto TEXT,
  -- Magnitud del impacto (4 dimensiones)
  impacto_legal INT CHECK (impacto_legal BETWEEN 1 AND 5),
  impacto_legal_detalle TEXT,
  impacto_reputacional INT CHECK (impacto_reputacional BETWEEN 1 AND 5),
  impacto_reputacional_detalle TEXT,
  impacto_operativo INT CHECK (impacto_operativo BETWEEN 1 AND 5),
  impacto_operativo_detalle TEXT,
  impacto_contagio INT CHECK (impacto_contagio BETWEEN 1 AND 5),
  impacto_contagio_detalle TEXT,
  impacto_ponderado NUMERIC GENERATED ALWAYS AS (
    ROUND(COALESCE(impacto_legal, 1) * 0.3 + COALESCE(impacto_reputacional, 1) * 0.4 +
          COALESCE(impacto_operativo, 1) * 0.2 + COALESCE(impacto_contagio, 1) * 0.1, 1)
  ) STORED,
  -- Probabilidad de ocurrencia
  probabilidad_ocurrencia INT CHECK (probabilidad_ocurrencia BETWEEN 1 AND 5),
  probabilidad_ocurrencia_detalle TEXT,
  probabilidad_frecuencia INT CHECK (probabilidad_frecuencia BETWEEN 1 AND 5),
  probabilidad_frecuencia_detalle TEXT,
  probabilidad INT GENERATED ALWAYS AS (
    GREATEST(COALESCE(probabilidad_ocurrencia, 1), COALESCE(probabilidad_frecuencia, 1))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_riesgo_causas_workspace ON riesgo_causas(workspace_id);
CREATE INDEX IF NOT EXISTS idx_riesgo_causas_riesgo ON riesgo_causas(riesgo_id);

ALTER TABLE riesgo_causas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "riesgo_causas_select" ON riesgo_causas FOR SELECT
  USING (workspace_id = current_user_workspace_id());
CREATE POLICY "riesgo_causas_insert" ON riesgo_causas FOR INSERT
  WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "riesgo_causas_update" ON riesgo_causas FOR UPDATE
  USING (workspace_id = current_user_workspace_id());
CREATE POLICY "riesgo_causas_delete" ON riesgo_causas FOR DELETE
  USING (workspace_id = current_user_workspace_id());

-- 5. Extender riesgos_controles con efectividad
ALTER TABLE riesgos_controles
  ADD COLUMN IF NOT EXISTS referencia TEXT,
  ADD COLUMN IF NOT EXISTS causa_id UUID REFERENCES riesgo_causas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actividad_control TEXT,
  ADD COLUMN IF NOT EXISTS ef_certeza INT CHECK (ef_certeza IN (1, 3)),
  ADD COLUMN IF NOT EXISTS ef_cambios_personal INT CHECK (ef_cambios_personal IN (1, 3)),
  ADD COLUMN IF NOT EXISTS ef_multiples_localidades INT CHECK (ef_multiples_localidades IN (1, 3)),
  ADD COLUMN IF NOT EXISTS ef_juicios_significativos INT CHECK (ef_juicios_significativos IN (1, 3)),
  ADD COLUMN IF NOT EXISTS ef_actividades_complejas INT CHECK (ef_actividades_complejas IN (1, 3)),
  ADD COLUMN IF NOT EXISTS ef_depende_otros INT CHECK (ef_depende_otros IN (1, 3)),
  ADD COLUMN IF NOT EXISTS ef_sujeto_actualizaciones INT CHECK (ef_sujeto_actualizaciones IN (1, 3)),
  ADD COLUMN IF NOT EXISTS ponderacion_factores NUMERIC,
  ADD COLUMN IF NOT EXISTS ponderacion_efectividad NUMERIC;

CREATE INDEX IF NOT EXISTS idx_riesgos_controles_causa ON riesgos_controles(causa_id);
