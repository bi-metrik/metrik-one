-- [98G] Dual responsables: comercial (quien vendió) + ejecución (quien ejecuta)
-- En oportunidades: responsable_id = responsable comercial
-- En proyectos: responsable_id = responsable ejecución, responsable_comercial_id = quien vendió (heredado de oportunidad)

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS responsable_comercial_id UUID REFERENCES staff(id);

CREATE INDEX IF NOT EXISTS idx_proyectos_responsable_comercial
  ON proyectos(responsable_comercial_id)
  WHERE responsable_comercial_id IS NOT NULL;
