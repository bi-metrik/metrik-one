-- Compliance Dual Informa — flags por workspace
-- Activa UI transparente "Consulta de Listas Restrictivas" en alma-afi (oculta validacion pura)
-- Activa UI "Comparativa Informa" (auditoria) en workspace metrik

-- ALMA-AFI: activar dual_informa (UX transparente), desactivar validacion pura
UPDATE workspaces
SET modules = jsonb_set(
  jsonb_set(
    COALESCE(modules, '{}'::jsonb),
    '{compliance_dual_informa}', 'true'::jsonb, true
  ),
  '{compliance_validacion}', 'false'::jsonb, true
)
WHERE slug = 'alma-afi';

-- Workspace metrik: activar compliance_audit (visibilidad comparativa)
UPDATE workspaces
SET modules = jsonb_set(
  COALESCE(modules, '{}'::jsonb),
  '{compliance_audit}', 'true'::jsonb, true
)
WHERE slug = 'metrik';
