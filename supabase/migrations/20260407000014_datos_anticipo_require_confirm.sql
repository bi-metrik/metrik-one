-- ============================================================
-- Bloque datos anticipo (etapa 2): agregar require_confirm
-- El usuario debe hacer click en "Confirmar anticipo" para
-- completar el bloque y disparar la creación del cobro
-- ============================================================

UPDATE bloque_configs
SET config_extra = config_extra || jsonb_build_object(
  'require_confirm', true,
  'confirm_label', 'Confirmar anticipo'
)
WHERE id = '9630e4c7-6b38-4ff6-b5d9-f755181984b6';
