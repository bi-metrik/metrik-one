-- SOENA · label_pregunta canónico para los bloques editables que producen
-- los fields evaluados en routing de decisiones del flujo VE.
--
-- Para que el rombo de decisión en <WorkflowDiagram> muestre una pregunta
-- natural en lugar del slug raw, el componente resuelve el label buscando
-- `config_extra.label_pregunta` en el bloque editable que define el field.
--
-- Aplicado en producción 2026-05-18 vía Management API. Esta migración
-- queda como artefacto para reproducibilidad y para que `db push` no la
-- vuelva a aplicar (idempotente por id).

-- Bloque "Registro UPME" → produce field `cargado_upme`
UPDATE bloque_configs
SET config_extra = config_extra || jsonb_build_object(
  'label_pregunta', '¿El vehículo ya está incluido en UPME?'
)
WHERE id = 'f859733c-1c38-49a5-b90e-0d145563043b';

-- Bloque "Devolución de IVA" → produce field `requiere_devolucion_iva`
UPDATE bloque_configs
SET config_extra = config_extra || jsonb_build_object(
  'label_pregunta', '¿Requiere devolución de IVA ante la DIAN?'
)
WHERE id = '07068eb5-8f0c-4eb4-a47d-e245515eb33f';
