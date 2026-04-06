-- ============================================================
-- 1. activity_log.tipo — agregar 'cambio_etapa'
--    El código insertaba tipo='cambio_etapa' pero el CHECK
--    solo permitía 'comentario','cambio','sistema' → fallos silenciosos
-- ============================================================

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_tipo_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_tipo_check
  CHECK (tipo IN ('comentario', 'cambio', 'sistema', 'cambio_etapa', 'cambio_estado'));

-- ============================================================
-- 2. SOENA etapa 1: gate 'comentario_requerido'
--    Debe haber al menos un comentario en actividad antes de
--    avanzar de "Por Contactar" a "Contactado"
-- ============================================================

UPDATE etapas_negocio
SET config_extra = config_extra || '{"gates": ["comentario_requerido"]}'::jsonb
WHERE orden = 1
  AND linea_id = (
    SELECT id FROM lineas_negocio
    WHERE workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'
      AND nombre = 'Proceso VE/HEV/PHEV'
  );
