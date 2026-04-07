-- ============================================================
-- Eliminar bloque "datos" fantasma en etapa 3 (sin campos, sin nombre)
-- ID: cc3545d5-99e2-4c67-aa44-9234c5dd979d
-- Ya no es gate (fix migración 010), pero sigue visible sin propósito
-- ============================================================

DO $$
DECLARE
  v_config_id UUID := 'cc3545d5-99e2-4c67-aa44-9234c5dd979d';
  v_count INT;
BEGIN
  -- 1. Eliminar negocio_bloques asociados
  DELETE FROM negocio_bloques WHERE bloque_config_id = v_config_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'negocio_bloques eliminados: %', v_count;

  -- 2. Eliminar el bloque_config
  DELETE FROM bloque_configs WHERE id = v_config_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'bloque_config eliminado: %', v_count;
END $$;
