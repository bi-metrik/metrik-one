-- ============================================================
-- Fix: bloque cotización SOENA etapas 1-2 → editable
-- Fix: permitir entidad_tipo='negocio' en activity_log
-- ============================================================

-- Cotización debe ser editable en las etapas iniciales del proceso VE
-- (actualmente 'visible' → solo muestra badge vacío con datos en blanco)
UPDATE bloque_configs
SET estado = 'editable'
WHERE workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'
  AND bloque_definition_id = '5fa77fa2-d4c1-4d94-9b63-bec9ed67e7bd'
  AND etapa_id IN (
    SELECT id FROM etapas_negocio
    WHERE linea_id = (
      SELECT id FROM lineas_negocio
      WHERE workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'
        AND nombre = 'Proceso VE/HEV/PHEV'
    )
    AND orden IN (1, 2)
  );
